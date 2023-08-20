# i18next to LinguiJS jscodehift Transformer

> Transformer for usage with [jscodeshift](https://github.com/facebook/jscodeshift) to
> migrate [i18next](https://www.i18next.com/) `t(...)` function to [Lingui](https://lingui.dev/) `t` literal template

## i18n-next `t(...)` to Lingui `t` macro transformer

_`t` function also is as an alias for `i18n.t(...)`_

```ts
const foo = t('key:subkey', {type: typeToReplace})
```

will be transformed to

```ts
const foo = t`Key ${typeToReplace} Source`
```

#### Supported cases

* `t('key:subkey')`
* `t('key:subkey', { type: typeToReplace })`
* translation keys flatten:
  ```ts
  const foo = `${t('key1')} ${count + 1} ${t('key2')}`
  ```
  will be transformed to
  ```ts
  const foo = t`Key1Source ${count + 1} Key2Source`
  ```

#### Currying of `t` macro

The currying of the `t` macro becomes essential when working with SSR or when real-time
translation switching is required within a component or React Hook.

By using `--with-currying-of-t-macro true` option for transformer, it allows you to convert ths code:

```tsx
t`Hello, ${world}!`
```

to this code:

```tsx
const {i18n} = useLingui();
const message = t(i18n)`Hello, ${world}!`;
```

#### Examples

```json5
// i18n/en.json dictionary
{
  "validation": {
    "string": {
      "max": "Value must be at most {{max}} characters"
    }
  }
}
```

```tsx
const max = 255;
t('validation:string.max', {max})
// will be transformed to
t`Value must be at most ${max} characters`
```

The result of executing `lingui extract` will be the following dictionary (`en.po`):

```gettext
msgid "Value must be at most {max} characters"
msgstr ""
```

### ⛔️ Trans

`Trans` component by _i18next_ is not supported and should be refactored to Lingui `Trans` manually.

### Usage HowTo

* Install `jscodeshift`
  ```bash
  npm install -g jscodeshift
  ```
* Navigate to the directory of the package you want to migrate from i18next to Lingui.
* Run in terminal
  ```bash
  jscodeshift --extensions=tsx,ts --parser=tsx \
  -t ./replace-i18n-next-with-lingui-t-macro-transformer.ts \
  --i18n-source-file ./i18n/en.json ./src/
  ```
  where `./i18n/en.json` is the path to the i18next translation source and `./src/` is the path to the directory with
  the source files to be transformed to use Lingui.
  > See [jscodeshift CLI options](https://github.com/facebook/jscodeshift#usage-cli)

# Lingui `t` macro to `useLingui()` transformer

You may only need this if you can't use the `t` macro (e.g., you don't want to link to LinguiJS compilation plugins).

#### Supported cases

* Converts from:
  ```ts
  t`Hello!`
  t`Hello, ${name}!`
  t`Hello, ${name}! (${counter + 1})`
  ```
  to:
  ```ts
  i18n._(`Hello!`)
  i18n._('Hello, {name}!', {name})
  i18n._('Hello, {name}! ({0})', {name, 0: counter + 1})
  ```
* Adds `const {i18n} = useLingui()` for each React component and hook that used the `t` macro.
* Removes `import from '@lingui/macro'` if not used anymore in the file.

### 🚧 Caveats

If the `t` macro is used inside a regular function, it will be necessary to manually pass the `i18n` argument into it or
make them such a hook.

```tsx
function MyComponent() {
  // ✅ const {i18n} = useLingui() // will be added by the transformer
  const foo = () => {
    t`Hello!`
  }
  return <div>{foo()}</div>
}

const useMyHook = () => {
  // ✅ const {i18n} = useLingui() // will be added by the transformer
  return t`Hello!`
}
const myRegularFunction = () => {
  // ⚠️⚠️⚠️⚠️⚠️⚠️⚠️⚠️⚠️⚠️⚠️⚠️⚠️
  // ⚠️ ⛔️ Will NOT be added by the transformer:
  // ⚠️ const {i18n} = useLingui()
  // ⚠️ You will need to add it manually or make it a hook
  // ⚠️ or pass the `i18n` argument into it
  // ⚠️⚠️⚠️⚠️⚠️⚠️⚠️⚠️⚠️⚠️⚠️⚠️⚠️
  return t`Hello!`
}
```

### Usage HowTo

- Navigate to the directory of the package you want to migrate from i18next to Lingui.
- Run in terminal
  ```bash
  jscodeshift --extensions=tsx,ts --parser=tsx --ignore-pattern="*.test.{ts,tsx}" \
  -t ../i18next-to-lingui-jscodehift-transformer/replace-lingui-t-macro-with-use-lingui-transformer.ts \
  ./src/
  ```
  where `./src/` is the path to the directory with the source files to be transformed to use `useLingui()`.
  > We ignore test files (`--ignore-pattern="*.test.{ts,tsx}"`) because they are not needed to be transformed.
  > See [jscodeshift CLI options](https://github.com/facebook/jscodeshift#usage-cli)
