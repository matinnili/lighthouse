/**
 * @license Copyright 2021 The Lighthouse Authors. All Rights Reserved.
 * Licensed under the Apache License, Version 2.0 (the "License"); you may not use this file except in compliance with the License. You may obtain a copy of the License at http://www.apache.org/licenses/LICENSE-2.0
 * Unless required by applicable law or agreed to in writing, software distributed under the License is distributed on an "AS IS" BASIS, WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied. See the License for the specific language governing permissions and limitations under the License.
 */
'use strict';

/* eslint-env jest */

import fs from 'fs';
import jsdom from 'jsdom';
import expect from 'expect';
import {DOM} from '../../renderer/dom.js';
import {LH_ROOT} from '../../../root.js';
import {getTextNodePossiblySignificantText} from '../../../build/build-report-components.js';

const html = fs.readFileSync(LH_ROOT + '/report/assets/templates.html', 'utf-8');
const {window} = new jsdom.JSDOM(html);
const tmplEls = window.document.querySelectorAll('template');

/**
 * @param {HTMLTemplateElement} tmplEl
 */
async function assertDOMTreeMatches(tmplEl) {
  global.document = window.document;
  global.Node = window.Node;
  global.DocumentFragment = window.DocumentFragment;

  const dom = new DOM(window.document);

  function cleanUselessNodes(parent) {
    for (const child of Array.from(parent.childNodes)) {
      if (child.nodeType === window.Node.TEXT_NODE) {
        const text = getTextNodePossiblySignificantText(child);
        if (!text) parent.removeChild(child);
        else child.textContent = text;
      } else if (child.nodeType === window.Node.COMMENT_NODE) {
        parent.removeChild(child);
      } else if (child.nodeType === window.Node.ELEMENT_NODE) {
        cleanUselessNodes(child);
      }
    }
  }

  function reorderAttributes(elem) {
    elem.querySelectorAll('*').forEach(elem => {
      const clonedAttrNodes = Array.from(elem.attributes);
      // Clear existing
      clonedAttrNodes.forEach(attr => elem.removeAttribute(attr.localName));
      // Apply class first, then the rest.
      const classAttr = clonedAttrNodes.find(attr => attr.localName === 'class');
      if (classAttr) {
        elem.setAttributeNode(classAttr);
      }
      clonedAttrNodes.forEach(attr => {
        if (attr !== classAttr) elem.setAttributeNode(attr);
      });
    });
  }

  /** @type {DocumentFragment} */
  const generatedFragment = dom.createComponent(tmplEl.id);
  const originalFragment = tmplEl.content.cloneNode(true);
  cleanUselessNodes(originalFragment);
  reorderAttributes(originalFragment);

  expect(generatedFragment.childNodes.length).toEqual(originalFragment.childNodes.length);
  for (let i = 0; i < generatedFragment.childNodes.length; i++) {
    expect(generatedFragment.childNodes[i].innerHTML)
      .toEqual(originalFragment.childNodes[i].innerHTML);
  }

  // TODO: also assert something else to catch how SVG elements serialize the same, even if they dont get built correctly (with createAttributeNS, etc)
}

for (const tmpEl of tmplEls) {
  it(`${tmpEl.id} component matches HTML source`, async () => {
    await assertDOMTreeMatches(tmpEl);
  });
}
