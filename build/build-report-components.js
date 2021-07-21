/**
 * @license Copyright 2021 The Lighthouse Authors. All Rights Reserved.
 * Licensed under the Apache License, Version 2.0 (the "License"); you may not use this file except in compliance with the License. You may obtain a copy of the License at http://www.apache.org/licenses/LICENSE-2.0
 * Unless required by applicable law or agreed to in writing, software distributed under the License is distributed on an "AS IS" BASIS, WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied. See the License for the specific language governing permissions and limitations under the License.
 */
'use strict';

// dumact

const fs = require('fs');
const jsdom = require('jsdom');
const {serializeArguments} = require('../lighthouse-core/gather/driver/execution-context.js');
const {LH_ROOT} = require('../root.js');

const html = fs.readFileSync(LH_ROOT + '/report/assets/templates.html', 'utf-8');
const {window} = new jsdom.JSDOM(html);
const tmplEls = window.document.querySelectorAll('template');

/**
 * @param {string} str
 */
function upperFirst(str) {
  return str.charAt(0).toUpperCase() + str.substr(1);
}

/**
 * @param {string} functionName
 * @param {string[]} bodyLines
 * @param {string[]} parameterNames
 */
function createFunctionCode(functionName, bodyLines, parameterNames = []) {
  const body = bodyLines.map(l => `  ${l}`).join('\n');
  const functionCode = `function ${functionName}(${parameterNames.join(', ')}) {\n${body}\n}`;
  return functionCode;
}

/**
 * @param {HTMLTemplateElement} tmpEl
 */
function compileTemplate(tmpEl) {
  const elemToVarNames = new Map();
  const lines = [];

  /**
   * @param {Element} el
   * @return {string}
   */
  function makeOrGetVarName(el) {
    const varName = elemToVarNames.get(el) || ('v' + elemToVarNames.size);
    elemToVarNames.set(el, varName);
    return varName;
  }

  /**
   * @param {Element} el
   */
  function process(el) {
    const isSvg = el.namespaceURI && el.namespaceURI.endsWith('/svg');
    const namespaceURI = isSvg ? el.namespaceURI : '';
    const tagName = el.localName;
    const className = el.classList.toString();

    let createElementFnName = 'createElement';
    const args = [tagName];
    if (className) {
      args.push(className);
    }
    if (namespaceURI) {
      createElementFnName = 'createElementNS';
      args.unshift(namespaceURI);
    }

    const varName = makeOrGetVarName(el);
    lines.push(`const ${varName} = dom.${createElementFnName}(${serializeArguments(args)});`);

    if (el.getAttributeNames) {
      for (const attr of el.getAttributeNames() || []) {
        if (attr === 'class') continue;

        lines.push(`${varName}.setAttribute('${attr}', '${el.getAttribute(attr)}');`);
      }
    }

    // const hasMultipleTextNodesWithContent = [...el.childNodes]
    //   .map(n => n.nodeType === window.Node.TEXT_NODE &&
    //             n.textContent && n.textContent.trim().length > 0).length > 1;
    // const hasMultipleTextNodesWithContent = el.children.length > 2;
    // for (const childEl of el.childNodes) {
    //   const n = childEl;
    //   // console.log(n.nodeType === window.Node.TEXT_NODE &&
    //   //   n.textContent && n.textContent.trim());
    //   if (n.nodeType === window.Node.TEXT_NODE && n.textContent && n.textContent.trim()) {
    //     // console.log('s:', n.textContent);
    //   }
    // }
    // console.log(el.children.length, hasMultipleTextNodesWithContent);

    // Whitespace at the beginning and at the end can be removed.
    let lower = 0;
    let upper = el.childNodes.length;
    if (el.childNodes.length > 0) {
      const node = el.childNodes[0];
      if (node.nodeType === window.Node.TEXT_NODE && node.textContent && !node.textContent.trim()) {
        lower += 1;
      }
    }
    if (el.childNodes.length > 1) {
      const node = el.childNodes[el.childNodes.length - 1];
      if (node.nodeType === window.Node.TEXT_NODE && node.textContent && !node.textContent.trim()) {
        upper -= 1;
      }
    }

    // TODO: the above assumes the first or last nodes wouldn't be a comment ... below is more generic. use?
    // for (const node of el.childNodes) {
    //   if (node.nodeType === window.Node.TEXT_NODE && node.textContent && !node.textContent.trim()) {
    //     lower += 1;
    //   } else {
    //     break;
    //   }
    // }
    // for (const node of [...el.childNodes].reverse()) {
    //   if (node.nodeType === window.Node.TEXT_NODE && node.textContent && !node.textContent.trim()) {
    //     upper -= 1;
    //   } else {
    //     break;
    //   }
    // }

    for (const childNode of [...el.childNodes].slice(lower, upper)) {
      if (childNode.nodeType === window.Node.COMMENT_NODE) continue;

      if (childNode.nodeType === window.Node.TEXT_NODE) {
        if (!childNode.parentElement) continue;
        if (!childNode.textContent) continue;

        let textContent = childNode.textContent;
        // Consecutive whitespace is redundant, unless in certain elements.
        if (!['pre', 'style'].includes(childNode.parentElement.tagName)) {
          textContent = textContent.replace(/\s+/g, ' ');
        }
        // Escaped string value for JS.
        textContent = JSON.stringify(textContent);

        const varName = makeOrGetVarName(childNode.parentElement);
        lines.push(`${varName}.append(dom.document().createTextNode(${textContent}));`);
        continue;
      }

      // @ts-expect-error: it's an Element.
      process(childNode);
      const childVarName = elemToVarNames.get(childNode);
      if (childVarName) lines.push(`${varName}.append(${childVarName});`);
    }
  }

  const fragmentVarName = makeOrGetVarName(tmpEl);
  lines.push(`const ${fragmentVarName} = dom.document().createDocumentFragment();`);

  for (const topLevelEl of tmpEl.content.children) {
    process(topLevelEl);
    lines.push(`${fragmentVarName}.append(${makeOrGetVarName(topLevelEl)});`);
  }

  lines.push(`return ${fragmentVarName};`);

  const componentName = tmpEl.id;
  const functionName = `create${upperFirst(componentName)}Component`;
  const jsdoc = `
/**
 * @param {DOM} dom
 */`;
  const functionCode = jsdoc + '\n' + createFunctionCode(functionName, lines, ['dom']);
  return {tmpEl, componentName, functionName, functionCode};
}

function makeGenericCreateComponentFunctionCode(processedTemplates) {
  const lines = [];

  lines.push('switch (componentName) {');
  for (const {componentName, functionName} of processedTemplates) {
    lines.push(`  case '${componentName}': return ${functionName}(dom);`);
  }
  lines.push('}');
  lines.push('throw new Error(\'unexpected component: \' + componentName)');

  const paramType = processedTemplates.map(t => `'${t.componentName}'`).join('|');
  const jsdoc = `
/** @typedef {${paramType}} ComponentName */
/**
 * @param {DOM} dom
 * @param {ComponentName} componentName
 * @return {DocumentFragment}
 */`;
  return jsdoc + '\nexport ' +
    createFunctionCode('createComponent', lines, ['dom', 'componentName']);
}

async function main() {
  const processedTemplates = [...tmplEls].map(compileTemplate);
  processedTemplates.sort((a, b) => a.componentName.localeCompare(b.componentName));
  const code = `
    'use strict';

    // auto-generated by build/build-report-components.js

    /** @typedef {import('./dom.js').DOM} DOM */

    /* eslint-disable max-len */

    ${processedTemplates.map(t => t.functionCode).join('\n')}

    ${makeGenericCreateComponentFunctionCode(processedTemplates)}
  `.trim();
  fs.writeFileSync(LH_ROOT + '/report/renderer/components.js', code);
}

main();
