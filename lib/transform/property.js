/*
 * Copyright 2017 Amazon.com, Inc. or its affiliates. All Rights Reserved.
 *
 * Licensed under the Apache License, Version 2.0 (the "License"). You may not use this file except in compliance with
 * the License. A copy of the License is located at
 *
 * http://www.apache.org/licenses/LICENSE-2.0
 *
 * or in the "license" file accompanying this file. This file is distributed on an "AS IS" BASIS, WITHOUT WARRANTIES OR
 * CONDITIONS OF ANY KIND, either express or implied. See the License for the specific language governing permissions
 * and limitations under the License.
 */

var _ = require('lodash');

/**
 * Based on the properties of dictionary, will get up the tree (depth steps) and return the
 * parent object for depth.
 * @param {{ ancestorTree: object, path: string[], depth: number}} config
 */
function getAncestorObject({ ancestorTree, path, depth }) {
  let resultObj = ancestorTree;
  for (let i = 0; i < depth; i += 1) {
    resultObj = resultObj[path[i]];
  }
  return resultObj;
}

// /**
//  * Checks if our token is annotated with a meta object. If so, it checks whether a certain
//  * condition applies within this meta (like (metaObj) => metaObj.isMixin)
//  * @param {{ dictionary: object, prop: object, condition: function}} config
//  */
// function conditionAppliesToMeta({ dictionary, prop, condition }) {
//   if (prop.path[prop.path.length - 1] === '_groupMeta') {
//     const metaObj = getAncestorObject({
//       ancestorTree: dictionary.properties,
//       path: prop.path,
//       depth: prop.path.length,
//     });
//     return condition(metaObj);
//   }
// }

/**
 * Applies all transforms to a property. This is a pure function,
 * it returns a new property object rather than mutating it inline.
 * @private
 * @param {Object} property
 * @param {Object} options
 * @returns {Object} - A new property object with transforms applied.
 */
function transformProperty(property, options) {
  var to_ret = _.clone(property);
  var transforms = options.transforms;

  for(var i = 0; i < transforms.length; i++ ) {
    var transform = transforms[i];

    if (!transform.matcher || transform.matcher(to_ret)) {
      if (transform.type === 'name') {
        to_ret.name = transform.transformer(to_ret, options);
      // Don't try to transform the value if it is referencing another value
      // Only try to transform if the value is not a string or if it has '{}'
      } else if (transform.type === 'value' && (!_.isString(property.value) || property.value.indexOf('{') < 0)) {
        to_ret.value = transform.transformer(to_ret, options);
      } else if (transform.type === 'attribute') {
        to_ret.attributes = _.extend({}, to_ret.attributes, transform.transformer(to_ret, options));
      } else if (transform.type === 'group') {
        // This will apply to the siblings in an object. Example:
        if (options.groupMeta) {
          to_ret = transform.transformer(to_ret, options);
        }
      }
    }
  }

  return to_ret;
}


module.exports = transformProperty;
