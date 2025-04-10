# Disallow browser.pause() in tests (wdio/no-pause)

`browser.pause(<number>)` statements cause an implicit wait and are often the reason for race conditions. We recommend to prefer explicit waits via `browser.waitUntil()` or wait on elements `$(elem).waitForExist()`.

## Rule Details

Examples of **incorrect** code for this rule:

```js
describe('my feature', () => {
    it('should do something', async () => {
        await browser.url('/');
        await browser.pause(1000);
        // ...
    });
});
```

Examples of **correct** code for this rule:

```js
describe('my feature', () => {
    it('should do something', async () => {
        await browser.url('/');
        // ...
    });
});
```

## Config

An object containing:

- `instances`: **string[]** name of instances to check, default is `["browser"]`, this is useful if you are using [multiremote](https://webdriver.io/docs/multiremote) instances.

### Config examples

```js
{
    'wdio/no-pause': ['error', { instances: ['myChromeBrowser', 'myFirefoxBrowser'] }]
}
```
