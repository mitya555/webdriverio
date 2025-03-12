import logger from '@wdio/logger'
import type { ClientOptions, RawData, WebSocket } from 'ws'
import { isIP } from 'node:net'
import dns from 'node:dns/promises'

import { environment } from '../environment.js'
import type * as remote from './remoteTypes.js'
import type { CommandData } from './remoteTypes.js'
import type { CommandResponse, ErrorResponse } from './localTypes.js'

import type { Client } from '../types.js'

const SCRIPT_PREFIX = '/* __wdio script__ */'
const SCRIPT_SUFFIX = '/* __wdio script end__ */'
const base64Regex = /^([A-Za-z0-9+/]{4})*([A-Za-z0-9+/]{3}=|[A-Za-z0-9+/]{2}==)?$/

const log = logger('webdriver')
const RESPONSE_TIMEOUT = 1000 * 60

export class BidiCore {
    #id = 0
    #ws: WebSocket | undefined
    #waitForConnected = Promise.resolve(false)
    #webSocketUrl: string
    #clientOptions: ClientOptions | undefined
    #pendingCommands: Map<number, (value: CommandResponse) => void> = new Map()

    client: Client | undefined
    /**
     * @private
     */
    private _isConnected = false

    constructor (webSocketUrl: string, opts?: ClientOptions) {
        this.#webSocketUrl = webSocketUrl
        this.#clientOptions = opts
    }

    /**
     * We initiate the Bidi instance before a WebdriverIO instance is created.
     * In order to emit Bidi events we have to attach the WebdriverIO instance
     * to the Bidi instance afterwards.
     */
    public attachClient (client: Client) {
        this.client = client
    }

    public async connect () {
        /**
         * don't connect and stale unit tests when the websocket url is set to a dummy value
         * Note: the value is defined in __mocks__/fetch.ts
         */
        if (process.env.WDIO_UNIT_TESTS) {
            this._isConnected = true
            return
        }

        log.info(`Connecting to webSocketUrl ${this.#webSocketUrl}`)
        // https://github.com/webdriverio/webdriverio/issues/14039
        const candidateUrls = await this.#listWebsocketCandidateUrls()
        this.#waitForConnected = this.#connectWebsocket(candidateUrls)
        return this.#waitForConnected
    }

    public close () {
        if (!this._isConnected) {
            return
        }

        log.info(`Close Bidi connection to ${this.#webSocketUrl}`)
        this._isConnected = false
        if (this.#ws) {
            this.#ws.off('message', this.#handleResponse.bind(this))
            this.#ws.close()
            this.#ws.terminate()
            this.#ws = undefined
        }
    }

    public reconnect (webSocketUrl: string, opts?: ClientOptions) {
        log.info(`Reconnect to new Bidi session at ${webSocketUrl}`)
        this.close()
        this.#webSocketUrl = webSocketUrl
        this.#clientOptions = opts
        return this.connect()
    }

    /**
     * Helper function that allows to wait until Bidi connection establishes
     * @returns a promise that resolves once the connection to WebDriver Bidi protocol was established
     */
    waitForConnected () {
        return this.#waitForConnected
    }

    get socket () {
        return this.#ws
    }

    get isConnected () {
        return this._isConnected
    }

    /**
     * for testing purposes only
     * @internal
     */
    get __handleResponse () {
        return this.#handleResponse.bind(this)
    }

    #handleResponse (data: RawData) {
        try {
            const payload = JSON.parse(data.toString()) as CommandResponse
            if (!payload.id) {
                return
            }

            /**
             * If the result is a base64 encoded string, we want to log a simplified version
             * of the result instead of the raw base64 encoded string
             */
            let resultLog = data.toString()
            if (typeof payload.result === 'object' && payload.result && 'data' in payload.result && typeof payload.result.data === 'string' && base64Regex.test(payload.result.data)) {
                resultLog = JSON.stringify({
                    ...payload.result,
                    data: `Base64 string [${payload.result.data.length} chars]`
                })
            }

            log.info('BIDI RESULT', resultLog)
            this.client?.emit('bidiResult', payload)
            const resolve = this.#pendingCommands.get(payload.id)
            if (!resolve) {
                log.error(`Couldn't resolve command with id ${payload.id}`)
                return
            }

            this.#pendingCommands.delete(payload.id)
            resolve(payload)
        } catch (err) {
            const error = err instanceof Error ? err : new Error(`Failed parse message: ${String(err)}`)
            log.error(`Failed parse message: ${error.message}`)
        }
    }

    public async send (params: Omit<CommandData, 'id'>): Promise<CommandResponse> {
        const id = this.sendAsync(params)
        const failError = new Error(`WebDriver Bidi command "${params.method}" failed`)
        const payload = await new Promise<CommandResponse | ErrorResponse>((resolve, reject) => {
            const t = setTimeout(() => {
                reject(new Error(`Command ${params.method} with id ${id} (with the following parameter: ${JSON.stringify(params.params)}) timed out`))
                this.#pendingCommands.delete(id)
            }, RESPONSE_TIMEOUT)
            this.#pendingCommands.set(id, (payload) => {
                clearTimeout(t)
                resolve(payload)
            })
        })

        if (payload.type === 'error' || 'error' in payload) {
            failError.message += ` with error: ${payload.error} - ${payload.message}`
            if (payload.stacktrace && typeof payload.stacktrace === 'string') {
                const driverStack = payload.stacktrace
                    .split('\n')
                    .filter(Boolean)
                    .map((line: string) => `    at ${line}`)
                    .join('\n')
                failError.stack += `\n\nDriver Stack:\n${driverStack}`
            }

            throw failError
        }

        return payload
    }

    public sendAsync (params: Omit<CommandData, 'id'>) {
        if (!this.#ws || !this._isConnected) {
            throw new Error('No connection to WebDriver Bidi was established')
        }

        log.info('BIDI COMMAND', ...parseBidiCommand(params))
        const id = ++this.#id
        this.client?.emit('bidiCommand', params)
        this.#ws.send(JSON.stringify({ id, ...params }))
        return id
    }

    async #listWebsocketCandidateUrls(): Promise<string[]> {
        const parsedUrl = new URL(this.#webSocketUrl)
        // https://github.com/webdriverio/webdriverio/issues/14039
        const candidateUrls: string[] = [this.#webSocketUrl]
        if (!isIP(parsedUrl.hostname)) {
            const candidateIps = (await Promise.all([
                dns.resolve4(parsedUrl.hostname),
                dns.resolve6(parsedUrl.hostname),
            ])).flat()
            // If the host resolves to a single IP address
            // then it does not make sense to try additional candidates
            // as the web socket DNS resolver would do exactly the same
            if (candidateIps.length > 1) {
                const hostnameMapper = (ip: string) => this.#webSocketUrl.replace(parsedUrl.hostname, ip)
                candidateUrls.push(...candidateIps.map(hostnameMapper))
            }
        }
        return candidateUrls
    }

    async #connectWebsocket(candidateUrls: string[]): Promise<boolean> {
        const wsConnectPromises: Promise<WebSocket | null>[] = []
        const errorMessages: string[] = []
        let onFirstWebsocketConnected = () => {}
        const firstWebsocketConnectedPromise = new Promise<void>((resolve) => {
            onFirstWebsocketConnected = resolve
        })
        const candidateWebsockets: WebSocket[] = []
        for (const candidateUrl of candidateUrls) {
            const ws = new environment.value.Socket(candidateUrl, this.#clientOptions) as unknown as WebSocket
            candidateWebsockets.push(ws)
            const connectPromise = new Promise<WebSocket | null>((resolve) => {
                ws.once('open', () => {
                    if (!this.#ws) {
                        log.info(`Connected session to Bidi protocol at ${candidateUrl}`)
                        this.#ws = ws
                        this.#ws.on('message', this.#handleResponse.bind(this))
                        onFirstWebsocketConnected()
                    }
                    resolve(ws)
                })
                ws.once('error', (err) => {
                    errorMessages.push(`Couldn't connect to Bidi protocol at ${candidateUrl}: ${err.message}`)
                    resolve(null)
                })
            })
            wsConnectPromises.push(connectPromise)
        }
        // We either wait until any web socket is successfully connected
        // or all of them fail
        await Promise.race([
            firstWebsocketConnectedPromise,
            Promise.all(wsConnectPromises)
        ])
        if (this.#ws) {
            // Cleanup extra opened sockets
            candidateWebsockets
                .filter((ws) => ws !== this.#ws)
                .forEach((ws) => ws.close())
            this._isConnected = true
        } else {
            for (const errorMessage of errorMessages) {
                log.warn(errorMessage)
            }
            this._isConnected = false
        }
        return this._isConnected
    }
}

export function parseBidiCommand (params:  Omit<CommandData, 'id'>) {
    const commandName = params.method
    if (commandName === 'script.addPreloadScript') {
        const param = params.params as remote.ScriptAddPreloadScriptParameters
        const logString = `{ functionDeclaration: <PreloadScript[${new TextEncoder().encode(param.functionDeclaration).length} bytes]>, contexts: ${JSON.stringify(param.contexts)} }`
        return [commandName, logString]
    } else if (commandName === 'script.callFunction') {
        const param = params.params as remote.ScriptCallFunctionParameters
        const fn = param.functionDeclaration
        let fnName = ''

        /**
         * extract function name from script when it's a function call from the 'webdriverio' package
         */
        if (fn.includes(SCRIPT_PREFIX)) {
            const internalFn = fn.slice(
                fn.indexOf(SCRIPT_PREFIX) + SCRIPT_PREFIX.length,
                fn.indexOf(SCRIPT_SUFFIX)
            )
            const functionPrefix = 'function '

            /**
             * we can only extract function name if it's a named function
             */
            if (internalFn.startsWith(functionPrefix)) {
                fnName = internalFn.slice(
                    internalFn.indexOf(functionPrefix) + functionPrefix.length,
                    internalFn.indexOf('(')
                )
            }
        }

        const logString = JSON.stringify({
            ...param,
            functionDeclaration: `<Function[${new TextEncoder().encode(param.functionDeclaration).length} bytes] ${fnName || 'anonymous'}>`
        })
        return [commandName, logString]
    }

    return [commandName, JSON.stringify(params.params)]
}
