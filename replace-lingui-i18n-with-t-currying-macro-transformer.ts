import jscodeshift, { FileInfo, ImportSpecifier } from 'jscodeshift';
import { ExpressionKind } from 'ast-types/gen/kinds';

export default function (
  fileInfo: FileInfo,
  api: { jscodeshift: typeof jscodeshift }
) {
  const j = api.jscodeshift;

  // Get the root node of the file
  const root = j(fileInfo.source);

  const linguiImports = root
    .find(j.ImportDeclaration)
    .filter(
      (path) =>
        typeof path.node.source.value === 'string' &&
        ['@lingui/react', '@lingui/core'].includes(path.node.source.value)
    )
    .filter((path) => {
      const specifiers = path.value.specifiers;
      return specifiers.some(
        (specifier) =>
          specifier.type === 'ImportSpecifier' &&
          ['I18n', 'useLingui'].includes(specifier.imported.name)
      );
    });

  // Find imports from '@lingui/macro'
  const importDeclaration = root
    .find(j.ImportDeclaration)
    .filter((path) => path.node.source.value === '@lingui/macro');

  if (importDeclaration.size() === 0) {
    if (linguiImports.size() > 0)
      // If import '@lingui/macro' is missing, add it
      root
        .get()
        .node.program.body.unshift(
          j.importDeclaration(
            [j.importSpecifier(j.identifier('t'))],
            j.literal('@lingui/macro')
          )
        );
  } else {
    // If import '@lingui/macro' is found, check if 't' is present in it
    const specifiers = importDeclaration.get(0).node.specifiers;
    const hasT = specifiers.some(
      (specifier: ImportSpecifier) =>
        specifier.imported && specifier.imported.name === 't'
    );

    if (!hasT) {
      // If 't' is missing, add it
      specifiers.push(j.importSpecifier(j.identifier('t')));
    }
  }

  // Return the new source code
  return root
    .find(j.CallExpression, {
      callee: {
        type: 'MemberExpression',
        object: {
          name: 'i18n',
        },
        property: {
          name: '_',
        },
      },
    })
    .filter((path) => {
      return ['StringLiteral', 'TemplateLiteral'].includes(
        path.node.arguments.at(0).type
      );
    })
    .replaceWith((path) => {
      const [message, params] = path.node.arguments as [
        jscodeshift.Literal | jscodeshift.TemplateLiteral,
        jscodeshift.ObjectExpression,
      ];
      const messageValue =
        message.type === 'TemplateLiteral'
          ? message.quasis[0].value.raw
          : message.value;

      const parts =
        typeof messageValue === 'string'
          ? messageValue.split(/(\{\w+?\})/g)
          : [];

      const expressions: ExpressionKind[] = [];
      const quasis: jscodeshift.TemplateElement[] = [];

      parts.forEach((part, index) => {
        if (part.startsWith('{') && part.endsWith('}')) {
          const paramKey = part.slice(1, -1).split(' ')[0];

          const paramValue = params.properties.find((p) => {
            if (!('key' in p)) return;

            return p.key.type === 'NumericLiteral'
              ? p.key.value === Number(paramKey) &&
                  paramKey === String(Number(paramKey))
              : 'name' in p.key && p.key.name === paramKey;
          });

          if (!paramValue || !('value' in paramValue))
            throw new Error('Invalid param value');

          expressions.push(paramValue?.value as ExpressionKind);
        } else {
          quasis.push(
            j.templateElement(
              { raw: part, cooked: part },
              index === parts.length - 1
            )
          );
        }
      });

      return j.taggedTemplateExpression(
        j.identifier('t(i18n)'),
        j.templateLiteral(quasis, expressions)
      );
    })
    .toSource();
}
