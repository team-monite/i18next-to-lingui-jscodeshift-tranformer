import type {
  ASTPath,
  ImportDeclaration,
  ImportSpecifier,
  Transform,
} from 'jscodeshift';

const transform: Transform = (file, api) => {
  const j = api.jscodeshift;
  const root = j(file.source);

  // Check if t import exists
  const hasTImport =
    root
      .find<ImportDeclaration>(j.ImportDeclaration, {
        source: {
          value: '@lingui/macro',
        },
      })
      .find<ImportSpecifier>(j.ImportSpecifier, { imported: { name: 't' } })
      .size() > 0;

  if (!hasTImport) {
    return file.source;
  }

  // Remove t import
  root
    .find<ImportDeclaration>(j.ImportDeclaration, {
      source: {
        value: '@lingui/macro',
      },
    })
    .find<ImportSpecifier>(j.ImportSpecifier, { imported: { name: 't' } })
    .remove();

  // Check if there are no specifiers left in the import declaration and remove it if so
  root
    .find<ImportDeclaration>(j.ImportDeclaration, {
      source: {
        value: '@lingui/macro',
      },
    })
    .forEach((path) => {
      if (path.node.specifiers?.length === 0) {
        j(path).remove();
      }
    });

  // Add useLingui import if it doesn't exist
  const hasUseLinguiImport =
    root
      .find<ImportDeclaration>(j.ImportDeclaration, {
        source: {
          value: '@lingui/react',
        },
      })
      .find<ImportSpecifier>(j.ImportSpecifier, {
        imported: { name: 'useLingui' },
      })
      .size() > 0;

  if (!hasUseLinguiImport) {
    root
      .find<ImportDeclaration>(j.ImportDeclaration)
      .at(-1)
      .insertAfter("import { useLingui } from '@lingui/react';");
  }

  // Find all functions which are React components or hooks and use `t`
  const reactFunctionsWithTUsage = root
    .find(j.TaggedTemplateExpression, {
      tag: { type: 'Identifier', name: 't' },
    })
    .map((path) => {
      let currentPath = path;
      let containingFunc = null;
      while (currentPath) {
        if (
          // eslint-disable-next-line @typescript-eslint/ban-ts-comment
          // @ts-ignore
          currentPath.value.type === 'FunctionDeclaration' ||
          // eslint-disable-next-line @typescript-eslint/ban-ts-comment
          // @ts-ignore
          currentPath.value.type === 'ArrowFunctionExpression' ||
          // eslint-disable-next-line @typescript-eslint/ban-ts-comment
          // @ts-ignore
          currentPath.value.type === 'FunctionExpression'
        ) {
          containingFunc = currentPath;
        }
        currentPath = currentPath.parentPath;
      }

      if (containingFunc) {
        let name;
        if ('id' in containingFunc.value && containingFunc.value.id) {
          // eslint-disable-next-line @typescript-eslint/ban-ts-comment
          // @ts-ignore
          name = containingFunc.value.id.name; // named function
        } else {
          let varDeclaratorPath = containingFunc;
          while (varDeclaratorPath) {
            if (varDeclaratorPath.value.type === 'VariableDeclarator') {
              name = varDeclaratorPath.value.id.name; // function assigned to variable
              break;
            }
            varDeclaratorPath = varDeclaratorPath.parentPath;
          }
        }

        if (name && isValidComponentOrHook(name)) return containingFunc;
      }
    })
    .paths()
    .map((path) => {
      // Find the closest function (FunctionDeclaration, FunctionExpression, or ArrowFunctionExpression)
      return path.scope.path.node;
    });

  const tUsedFunctionBodySet = new Set<ASTPath>();

  // For each function, add `const { i18n } = useLingui();` to the beginning
  reactFunctionsWithTUsage.forEach((func) => {
    if (func.body.type !== 'BlockStatement' && !func.body.body) {
      // Replace the expression with a code block with an explicit return value
      func.body = {
        type: 'BlockStatement',
        body: [
          {
            type: 'ReturnStatement',
            argument: func.body,
          },
        ],
      };
    }

    // Insert the variable declaration at the beginning of the function body
    if (func.body.body) {
      tUsedFunctionBodySet.add(func.body.body);
    }
  });

  tUsedFunctionBodySet.forEach((body) => {
    const i18nUseLinguiCode = j.template
      .statement`const { i18n } = useLingui();`;

    body.unshift(i18nUseLinguiCode);
  });

  // Replaces t`Hello!` with i18n.t('Hello!') in the entire file
  // Replaces t`Hello, ${world}` with i18n.t({id: 'Hello, {world}', values: {world}}) in the entire file
  // Replaces t`Hello, ${1 + getSize()} of {length()}` with i18n.t({id: 'Hello, {0} of {1}', values: {0: 1 + getSize(), 1: length()}}) in the entire file
  root
    .find(j.TaggedTemplateExpression, {
      tag: {
        type: 'Identifier',
        name: 't',
      },
    })
    .forEach((path) => {
      const templateLiteral = path.node.quasi;
      let id = '';
      const values = [];
      const complexExpressions = [];

      // Generate string for 'id' and array of variable names for 'values'
      templateLiteral.quasis.forEach((quasi, i) => {
        id += quasi.value.raw;
        if (templateLiteral.expressions[i]) {
          const expression = templateLiteral.expressions[i];
          if (expression.type === 'Identifier') {
            id += `{${expression.name}}`;
            values.push(expression.name);
          } else {
            id += `{${i}}`;
            complexExpressions.push([i, expression]);
          }
        }
      });

      if (values.length > 0 || complexExpressions.length > 0) {
        // Create object for passing variables
        const valuesProperties = [
          ...[...new Set(values)].map((value) =>
            j.property('init', j.identifier(value), j.identifier(value))
          ),
          ...complexExpressions
            .filter(
              ([expressionPosition], index, self) =>
                self.findIndex(
                  ([firstExpressionPosition]) =>
                    firstExpressionPosition === expressionPosition
                ) === index
            )
            .map(([expressionPosition, expression]) =>
              j.property(
                'init',
                j.identifier(String(expressionPosition)),
                expression
              )
            ),
        ];
        const valuesObject = j.objectExpression(valuesProperties);

        // Replace t`...` with i18n._({...})
        j(path).replaceWith(
          j.callExpression(
            j.memberExpression(j.identifier('i18n'), j.identifier('_')),
            [j.literal(id), valuesObject]
          )
        );
      } else {
        // Replace t`...` with i18n._("...")
        j(path).replaceWith(
          j.callExpression(
            j.memberExpression(j.identifier('i18n'), j.identifier('_')),
            [j.literal(id)]
          )
        );
      }
    });

  return root.toSource();
};

function isValidComponentOrHook(funcName: string) {
  return (
    funcName.at(0) === funcName.at(0).toUpperCase() ||
    (funcName.startsWith('use') &&
      funcName.at(3) === funcName.at(3).toUpperCase())
  );
}

export default transform;
