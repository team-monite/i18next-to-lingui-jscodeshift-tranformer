import fs from 'fs';
import {
  API,
  ArrowFunctionExpression,
  ASTPath,
  CallExpression,
  Collection,
  FileInfo,
  FunctionDeclaration,
  ImportDeclaration,
  ImportSpecifier,
  JSCodeshift,
  Options,
  TaggedTemplateExpression,
} from 'jscodeshift';
import path from 'path';

const getTranslations = (options: Options) => {
  const i18nSourceFileOption = options['i18n-source-file'];

  if (!i18nSourceFileOption)
    throw new Error('--i18n-source-file <filepath> options is required');

  const i18nSourceFilePath = path.resolve(process.cwd(), i18nSourceFileOption);
  if (!fs.existsSync(i18nSourceFilePath))
    throw new Error(
      `Source translation file not found: "${i18nSourceFileOption}"`
    );

  return JSON.parse(fs.readFileSync(i18nSourceFilePath).toString()) as Record<
    string,
    string | Record<string, string>
  >;
};

export default function transformer(
  file: FileInfo,
  api: API,
  options: Options
) {
  const j = api.jscodeshift;
  const translationSourceFile = getTranslations(options);

  if (
    !hasNodesToTranslate(file.source, j) &&
    !hasTranslateFunctionCalls(file.source, j)
  ) {
    return file.source;
  }

  let source = file.source;

  source = removeIArgFromFunctionDeclarationTransformer(source, j);
  source = removeIArgFromFunctionCallTransformer(source, j);
  source = removeIVarFromArraysTransformer(source, j);

  source = removeUseComponentsContextTransformer(source, j);

  source = removeUnusedImportTransformer(
    source,
    { type: 'named', name: 'useMoniteContext' },
    j
  );
  source = removeUnusedImportTransformer(
    source,
    { type: 'named', name: 'TFunction' },
    j
  );

  source = removeUseTranslationHookTransformer(source, j);
  if (hasNodesToTranslate(source, j)) {
    source = addLinguiMacroImportTransformer(source, j);
  }
  source = removeUseTranslationImportTransformer(source, j);
  source = replaceI18TFuncWithTLiteralTemplateTransformer(
    source,
    j,
    translationSourceFile,
    false
  );

  source = removeUnusedImportTransformer(
    source,
    { type: 'default', name: 'i18n' },
    j
  );

  source = replaceTranslateImportToTTransformer(source, j);
  source = joinMultipleTLiteralTemplate(source, j);

  if (
    options['with-currying-of-t-macro'] &&
    options['with-currying-of-t-macro']?.toLocaleLowerCase?.() !== 'false' &&
    options['with-currying-of-t-macro']?.toLocaleLowerCase?.() !== 'no'
  )
    source = curryingOfTMacro(source, j);

  return source;
}

const removeIArgFromFunctionDeclarationTransformer = (
  source: string,
  j: JSCodeshift
) => {
  const root = j(source);

  root.find(j.ArrowFunctionExpression).forEach(removeTArg);
  root.find(j.FunctionDeclaration).forEach(removeTArg);

  function removeTArg<N extends ArrowFunctionExpression | FunctionDeclaration>(
    node: ASTPath<N>
  ) {
    const paramIndex = node.value.params.findIndex((param) => {
      const isTParam =
        param.type === 'Identifier' &&
        param.name === 't' &&
        param.typeAnnotation &&
        param.typeAnnotation.typeAnnotation?.type === 'TSTypeReference' &&
        'name' in param.typeAnnotation.typeAnnotation.typeName &&
        param.typeAnnotation.typeAnnotation.typeName.name === 'TFunction';
      return isTParam;
    });

    if (paramIndex !== -1) {
      node.value.params.splice(paramIndex, 1);
    }
  }

  return root.toSource();
};

const removeIArgFromFunctionCallTransformer = (
  source: string,
  j: JSCodeshift
) => {
  const root = j(source);

  root.find(j.CallExpression).forEach((node) => {
    const tArgIndex = node.value.arguments.findIndex(
      (arg) => 'name' in arg && arg.name === 't'
    );
    if (tArgIndex !== -1) {
      node.value.arguments.splice(tArgIndex, 1);
    }
  });

  return root.toSource();
};

const removeIVarFromArraysTransformer = (source: string, j: JSCodeshift) => {
  const root = j(source);

  root.find(j.ArrayExpression).forEach((arrayPath) => {
    const filteredElements = arrayPath.node.elements.filter(
      (element) => !(element && 'name' in element && element.name === 't')
    );
    if (filteredElements.length !== arrayPath.node.elements.length)
      arrayPath.replace(j.arrayExpression(filteredElements));
  });

  return root.toSource();
};

const removeUseComponentsContextTransformer = (
  source: string,
  j: JSCodeshift
) => {
  const root = j(source);

  const useComponentsContextCalls = root.find(j.VariableDeclarator, {
    id: { type: 'ObjectPattern' },
    init: {
      type: 'CallExpression',
      callee: { name: 'useMoniteContext' },
    },
  });

  useComponentsContextCalls.forEach((path) => {
    const objectPattern = path.value.id;

    if (!('properties' in objectPattern)) return;

    objectPattern.properties = objectPattern.properties.filter(
      (prop) =>
        prop.type !== 'ObjectProperty' ||
        !('name' in prop.key) ||
        prop.key.name !== 't'
    );
  });

  useComponentsContextCalls
    .filter((path) => {
      const objectPattern = path.value.id;
      if (!('properties' in objectPattern)) return false;
      return !objectPattern.properties.length;
    })
    .remove();

  return root.toSource();
};

const removeUnusedImportTransformer = (
  source: string,
  importSpecifier: { type: 'named' | 'default'; name: string },
  j: JSCodeshift
) => {
  const root = j(source);

  const imports = root.find(j.ImportDeclaration, {
    specifiers: [
      importSpecifier.type === 'named'
        ? {
            type: 'ImportSpecifier',
            imported: {
              name: importSpecifier.name,
            },
          }
        : {
            type: 'ImportDefaultSpecifier',
          },
    ],
  });

  imports
    .filter((importDeclaration) => {
      if (importDeclaration.value.type !== 'ImportDeclaration') return false;

      const bindingName = importDeclaration.node?.specifiers?.[0]?.local?.name;

      if (bindingName !== importSpecifier.name) return false;

      const binding = root.find(j.Identifier, {
        name: importSpecifier.name,
      });

      return (
        binding
          .filter((path) => !['local', 'imported'].includes(path.name))
          .size() === 0
      );
    })
    .remove();

  return root.toSource();
};

const removeUseTranslationImportTransformer = (
  source: string,
  j: JSCodeshift
) => {
  const i18nImports = j(source).find(j.ImportDeclaration, {
    source: { value: 'react-i18next' },
  });

  i18nImports
    .find(j.ImportSpecifier, { imported: { name: 'useTranslation' } })
    .remove();

  i18nImports.forEach((path) => {
    if (path.node.specifiers?.length === 0) {
      j(path).remove();
    }
  });

  return i18nImports.toSource();
};

const removeUseTranslationHookTransformer = (
  source: string,
  j: JSCodeshift
) => {
  return j(source)
    .find(j.VariableDeclarator, {
      init: {
        type: 'CallExpression',
        callee: { name: 'useTranslation' },
      },
    })
    .remove()
    .toSource();
};

const addLinguiMacroImportTransformer = (source: string, j: JSCodeshift) => {
  return j(source)
    .find(j.ImportDeclaration)
    .at(-1)
    .insertAfter(
      j.importDeclaration(
        [j.importSpecifier(j.identifier('t'), j.identifier('translate'))],
        j.literal('@lingui/macro')
      )
    )
    .toSource();
};

const hasTranslateFunctionCalls = (source: string, j: JSCodeshift) => {
  return !!j(source)
    .find(j.Identifier, {
      name: 't',
    })
    .size();
};

const hasNodesToTranslate = (source: string, j: JSCodeshift) => {
  const root = j(source);
  return (
    !!root
      .find(j.CallExpression, {
        callee: { name: 't' },
      })
      .size() ||
    !!root
      .find(j.CallExpression, {
        callee: {
          property: {
            name: 't',
          },
          object: {
            name: 'i18n',
          },
        },
      })
      .size()
  );
};

const replaceI18TFuncWithTLiteralTemplateTransformer = (
  source: string,
  j: JSCodeshift,
  translations: Record<string, unknown>,
  returnTranslationString: boolean
) => {
  return replaceTranslations(source);

  function replaceTranslations(nodeSource: string) {
    const replaceTranslationInPaths = (paths: Collection<CallExpression>) =>
      paths.replaceWith((path) => {
        const { node } = path;

        const messageArg = node.arguments[0];
        const paramsArg = node.arguments[1];

        if (j.TemplateLiteral.check(messageArg)) {
          throw new Error('Template literals are not supported');
        }

        if (!j.StringLiteral.check(messageArg)) {
          return node;
        }

        const translationMessage = getArgumentTranslationMessage(
          messageArg,
          translations,
          j
        );

        const params =
          paramsArg && 'properties' in paramsArg
            ? paramsArg.properties.reduce<
                Record<string, [flatten: boolean, source: string]>
              >((acc, property) => {
                if (
                  'key' in property &&
                  'name' in property.key &&
                  'value' in property &&
                  typeof property.key.name === 'string'
                ) {
                  const propertyValueSource = j(property.value).toSource();
                  const propertyValueSourceReplaced =
                    replaceI18TFuncWithTLiteralTemplateTransformer(
                      propertyValueSource,
                      j,
                      translations,
                      true
                    );

                  return {
                    ...acc,
                    [property.key.name]: [
                      propertyValueSource !== propertyValueSourceReplaced,
                      propertyValueSourceReplaced,
                    ],
                  };
                }
                throw new Error(
                  `Unexpected property in params argument: ${j(
                    property
                  ).toSource()}`
                );
              }, {})
            : undefined;

        const transTemplate = generateTransTemplate(
          translationMessage,
          params ?? {}
        );

        if (returnTranslationString) return `"${transTemplate}"`;
        else return `translate\`${transTemplate}\``;
      });

    const root = j(nodeSource);

    replaceTranslationInPaths(
      root.find(j.CallExpression, {
        callee: { name: 't' },
      })
    );

    replaceTranslationInPaths(
      root.find(j.CallExpression, {
        callee: {
          property: {
            name: 't',
          },
          object: {
            name: 'i18n',
          },
        },
      })
    );

    return root.toSource();
  }
};

/**
 * Carrying of `t` macro with `t(i18n)`
 */
const curryingOfTMacro = (source: string, j: JSCodeshift) => {
  const root = j(source);

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
    .find(TaggedTemplateExpression, {
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

  root
    .find(j.TaggedTemplateExpression, {
      tag: {
        type: 'Identifier',
        name: 't',
      },
    })
    .replaceWith((path) => {
      const newTag = j.callExpression(j.identifier('t'), [
        j.identifier('i18n'),
      ]);
      return j.taggedTemplateExpression(newTag, path.node.quasi);
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

export function joinMultipleTLiteralTemplate(source: string, j: JSCodeshift) {
  const root = j(source);

  root
    .find(j.TemplateLiteral, {
      expressions: [{ type: 'TaggedTemplateExpression', tag: { name: 't' } }],
    })
    .replaceWith((path) => {
      const replaceMap: Record<string, string> = {};
      path.value.expressions.forEach((expression) => {
        if (
          j.TaggedTemplateExpression.check(expression) &&
          'name' in expression.tag &&
          expression.tag.name === 't'
        ) {
          const value = expression.quasi?.quasis?.[0].value.cooked;
          if (typeof value !== 'string') throw new Error('value is not string');
          replaceMap[j(expression).toSource()] = value;
        }
      });

      const pathSource = j(path).toSource();

      const pathSourceFixed = Object.entries(replaceMap).reduce(
        (acc, [literalTemplate, value]) => {
          literalTemplate = `\${${literalTemplate}}`;
          while (acc.includes(literalTemplate)) {
            acc =
              acc.slice(0, acc.indexOf(literalTemplate)) +
              value +
              acc.slice(acc.indexOf(literalTemplate) + literalTemplate.length);
          }
          return acc;
        },
        pathSource
      );

      return `t${pathSourceFixed}`;
    });

  return root.toSource();
}

export const replaceTranslateImportToTTransformer = (
  source: string,
  j: JSCodeshift
) => {
  const root = j(source);

  const linguiMacroImports = root.find(j.ImportDeclaration, {
    source: {
      value: '@lingui/macro',
    },
  });

  linguiMacroImports
    .find(j.ImportSpecifier, {
      imported: {
        name: 't',
      },
    })
    .forEach((path) => {
      j(path).replaceWith(j.importSpecifier(j.identifier('t')));
    });

  root
    .find(j.Identifier, {
      name: 'translate',
    })
    .forEach((path) => {
      j(path).replaceWith(j.identifier('t'));
    });

  return linguiMacroImports.toSource();
};

const getArgumentTranslationMessage = (
  messageArg: CallExpression['arguments'][number],
  translations: Record<string, unknown>,
  j: JSCodeshift
) => {
  if (j.TemplateLiteral.check(messageArg)) {
    throw new Error('Template literals are not supported');
  }

  if (!j.StringLiteral.check(messageArg)) {
    throw new Error('Template literals in not a string');
  }

  const messageKeyPath = messageArg.value
    .split(':')
    .map((message, index) => {
      if (index) return message.split('.');
      return message;
    })
    .flat();

  const translationMessage = messageKeyPath.reduce<object | string>(
    (acc, key) => {
      if (acc && typeof acc === 'object' && key in acc)
        return acc[key as keyof typeof acc];
      throw new Error(
        `Translation key ${key} not found in translation string ${messageArg.value}`
      );
    },
    translations
  );

  if (!translationMessage || typeof translationMessage !== 'string') {
    throw new Error(
      `Translation message fro key ${messageArg.value} is ${JSON.stringify(
        translationMessage
      )}`
    );
  }

  return translationMessage;
};

const generateTransTemplate = (
  message: string,
  params: Record<string, [flatten: boolean, source: string]>
) => {
  let template = message;

  for (const [paramName, [isParamFlatten, paramValue]] of Object.entries(
    params
  )) {
    template = template.replace(
      new RegExp(`{{${paramName}}}`, 'g'),
      isParamFlatten ? JSON.parse(paramValue.slice(0, -1)) : `\${${paramValue}}`
    );
  }

  return template;
};
