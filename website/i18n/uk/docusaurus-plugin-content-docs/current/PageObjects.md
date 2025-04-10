---
id: pageobjects
title: Шаблон Page Object
---

5-та версія WebdriverIO була розроблена з підтримкою Page Object Pattern. Впровадження принципу «елементи як першокласні об'єкти» дозволило створювати великі набори тестів, використовуючи цей патерн.

Для створення об'єктів сторінок не потрібні додаткові пакети. Виявляється, що чисті, сучасні класи надають всі необхідні функції, які нам потрібні:

- успадкування між об’єктами сторінки
- повільне завантаження елементів
- інкапсуляція методів та дій

Мета використання об'єктів сторінок - відокремити будь-яку інформацію про сторінку від самих тестів. В ідеалі, ви повинні зберігати всі селектори або специфічні інструкції, які є унікальними для певної сторінки, в об'єкті сторінки, щоб ви могли запустити свій тест після того, як повністю переробили сторінку.

## Створення об'єкта сторінки

Для початку, нам потрібен об'єкт головної сторінки, який ми назвемо `Page.js`. Він буде містити загальні селектори або методи, від яких успадковуватимуться всі об'єкти сторінки.

```js
// Page.js
export default class Page {
    constructor() {
        this.title = 'My Page'
    }

    async open (path) {
        await browser.url(path)
    }
}
```

Ми завжди експортуємо(`export`) екземпляр об'єкта сторінки та ніколи не створюємо його в тесті. Оскільки ми пишемо end-to-end тести, ми завжди розглядаємо сторінку як конструкцію без стану &mdash; так само як кожен HTTP-запит є конструкцією без стану.

Звичайно, браузер може зберігати інформацію про сесію і, відповідно, відображати різні сторінки на основі різних сесій, але це не повинно відображатися в об'єкті сторінки. Такі зміни стану повинні відбуватися у ваших реальних тестах.

Почнімо тестувати першу сторінку. Для демонстрації, як піддослідного кролика, ми використаємо вебсайт [The Internet](http://the-internet.herokuapp.com) від компанії [Elemental Selenium](http://elementalselenium.com). Спробуємо створити приклад об'єкта сторінки для [сторінки входу в систему](http://the-internet.herokuapp.com/login).

## Отримаймо(`Get`) ваші селектори

Перший крок - написати всі важливі селектори, які потрібні в нашому об'єкті `login.page`, як getter-функції:

```js
// login.page.js
import Page from './page'

class LoginPage extends Page {

    get username () { return $('#username') }
    get password () { return $('#password') }
    get submitBtn () { return $('form button[type="submit"]') }
    get flash () { return $('#flash') }
    get headerLinks () { return $$('#header a') }

    async open () {
        await super.open('login')
    }

    async submit () {
        await this.submitBtn.click()
    }

}

export default new LoginPage()
```

Визначення селекторів у getter-функціях може виглядати трохи дивно, але це дійсно корисно. Ці функції обробляються, _коли ви отримуєте доступ до властивості_, а не коли ви генеруєте об'єкт. Таким чином, ви завжди запитуєте елемент перед тим, як виконати над ним якусь дію.

## Ланцюги команд

WebdriverIO внутрішньо запам'ятовує останній результат виконання команди. Якщо ви з'єднаєте команду елемента з командою дії, він знайде елемент з попередньої команди та використає цей результат для виконання дії. При цьому ви можете прибрати селектор (перший параметр) і команда буде виглядати так само просто, як і раніше:

```js
await LoginPage.username.setValue('Max Mustermann')
```

Який по суті є тим же самим, що і як:

```js
let elem = await $('#username')
await elem.setValue('Max Mustermann')
```

або

```js
await $('#username').setValue('Max Mustermann')
```

## Використання об'єктів сторінки у ваших тестах

Після того, як ви визначили необхідні елементи та методи для сторінки, ви можете приступити до написання тесту для неї. Все, що вам потрібно зробити, щоб використовувати об'єкт сторінки - це імпортувати (`import` або `require`) його. І все!

Оскільки ви експортували вже створений екземпляр об'єкта сторінки, його імпорт дозволить вам одразу ж почати використовувати його.

Якщо ви використовуєте структуру тверджень, ваші тести можуть бути ще більш виразними:

```js
// login.spec.js
import LoginPage from '../pageobjects/login.page'

describe('login form', () => {
    it('should deny access with wrong creds', async () => {
        await LoginPage.open()
        await LoginPage.username.setValue('foo')
        await LoginPage.password.setValue('bar')
        await LoginPage.submit()

        await expect(LoginPage.flash).toHaveText('Your username is invalid!')
    })

    it('should allow access with correct creds', async () => {
        await LoginPage.open()
        await LoginPage.username.setValue('tomsmith')
        await LoginPage.password.setValue('SuperSecretPassword!')
        await LoginPage.submit()

        await expect(LoginPage.flash).toHaveText('You logged into a secure area!')
    })
})
```

Зі сторони структури має сенс розділити файли специфікацій та об'єкти сторінок на різні директорії. Крім того, ви можете надати кожному об'єкту сторінки закінчення: `.page.js`. Так буде зрозуміліше, що ви імпортуєте об'єкт сторінки.

## Йдемо далі

Це основний принцип написання об'єктів сторінок за допомогою WebdriverIO. Але ви можете створювати набагато складніші структури об'єктів сторінок, ніж ця! Наприклад, ви можете створити окремі об'єкти сторінок для модальних елементів або розділити величезний об'єкт сторінки на різні класи (кожен з яких представляє окрему частину загальної веб-сторінки), які успадковують від головного об'єкта сторінки. Цей патерн дійсно надає багато можливостей для відокремлення інформації про сторінку від ваших тестів, що важливо для того, щоб зберегти ваш набір тестів структурованим і чітким у часи, коли проєкт і кількість тестів зростають.

Ви можете знайти цей приклад (і навіть більше прикладів об'єктів сторінок) у [теці `example`](https://github.com/webdriverio/webdriverio/tree/main/examples/pageobject) на GitHub.
