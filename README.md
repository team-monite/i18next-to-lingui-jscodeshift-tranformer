# i18next to LinguiJS js-codeshift Transformer

This transformer integrates with [jscodeshift](https://github.com/facebook/jscodeshift) to help migrate
from [i18next](https://www.i18next.com/) `t(...)` function to [Lingui](https://lingui.dev/) `t` literal template.

## Transforming i18n-next `t(...)` to Lingui `t` Macro

_The `t` function is an alias for `i18n.t(...)`._

```ts
const foo = t('key:subkey', {type: typeToReplace})
```

will be transformed to

```ts
const foo = t`Key ${typeToReplace} Source`
```

### Supported Cases

* `t('key:subkey')`
* `t('key:subkey', { type: typeToReplace })`
* Flattening translation keys:
  ```ts
  const foo = `${t('key1')} ${count + 1} ${t('key2')}`
  ```
  will be transformed to
  ```ts
  const foo = t`Key1Source ${count + 1} Key2Source`
  ```

### Currying of `t` Macro

Currying the `t` macro is essential for working with SSR or when real-time translation switching is needed within a
component or React Hook. The `--with-currying-of-t-macro true` option allows you to convert this:

```tsx
t`Hello, ${world}!`
```

to:

```tsx
const {i18n} = useLingui();
const message = t(i18n)`Hello, ${world}!`;
```

### Examples

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

Executing `lingui extract` will result in the following dictionary (`en.po`):

```gettext
msgid "Value must be at most {max} characters"
msgstr ""
```

### ⛔️ Trans Component

The _i18next_ `Trans` component is not supported and should be manually refactored to Lingui `Trans`.

## Usage Guide

1. **Installation of `jscodeshift`:**
   ```bash
   npm install -g jscodeshift
   ```
2. **Navigate to the directory of the package you want to migrate from i18next to Lingui.**
3. **Run the following command in the terminal:**
   ```bash
   jscodeshift --extensions=tsx,ts --parser=tsx \
   -t ./replace-i18n-next-with-lingui-t-macro-transformer.ts \
   --i18n-source-file ./i18n/en.json ./src/
   ```
   where `./i18n/en.json` is the path to the i18next translation source and `./src/` is the directory containing the
   source files to be transformed to use Lingui.
   > See [jscodeshift CLI options](https://github.com/facebook/jscodeshift#usage-cli)

# Additional Transformations

## Lingui `t` Macro to `useLingui()` Transformer

> 🚨 This transformation might only be needed if you can't use the `t` macro (e.g., you don't want to link to LinguiJS
> compilation plugins).

### Supported Cases

* Converts from:
  ```ts
  t`Hello!`
  t`Hello, ${name}!`
  t`Hello, ${name}! (${counter + 1})`
  ```
  to:
  ```ts
  i18n._('Hello!')
  i18n._('Hello, {name}!', {name})
  i18n._('Hello, {name}! ({0})', {name, 0: counter + 1})
  ```
* Adds `const {i18n} = useLingui()` for each React component and hook that used the `t` macro.
* Removes `import {} from '@lingui/macro'` if no longer used in the file.

### 🚧 Caveats

If the `t` macro is used inside a regular function, it will be necessary to manually pass the `i18n` argument into it or
make them such a Hook.

```tsx
function MyComponent() { // looks Like a React Component
  // ✅ const {i18n} = useLingui() // will be added by the transformer
  const foo = () => {
    t`Hello!`
  }
  return <div>{foo()}</div>
}

const useMyHook = () => { // looks like a React Hook
  // ✅ const {i18n} = useLingui() // will be added by the transformer
  return t`Hello!`
}
const myRegularFunction = () => { // doesn't look like a React Component or Hook
  // ⚠️⚠️⚠️⚠️⚠️⚠️⚠️⚠️⚠️⚠️⚠️⚠️⚠️
  // ⚠️ ⛔️ Will NOT be added by the transformer:
  // ⚠️ const {i18n} = useLingui()
  // ⚠️ You will need to add it manually or make it a hook
  // ⚠️ or pass the `i18n` argument into it
  // ⚠️⚠️⚠️⚠️⚠️⚠️⚠️⚠️⚠️⚠️⚠️⚠️⚠️
  return t`Hello!`
}
```

### Usage Guide

- Navigate to the directory of the package you want to migrate from i18next to Lingui.
- Run in terminal:
  ```bash
  jscodeshift --extensions=tsx,ts --parser=tsx --ignore-pattern="*.test.{ts,tsx}" \
  -t ../i18next-to-lingui-jscodehift-transformer/replace-lingui-t-macro-with-use-lingui-transformer.ts \
  ./src/
  ```
  where `./src/` is the directory with the source files to be transformed to use `useLingui()`.
  > Test files are ignored as they are not needed for transformation.
  > See [jscodeshift CLI options](https://github.com/facebook/jscodeshift#usage-cli)
