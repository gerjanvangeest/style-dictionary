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

var resolveObject = require("./utils/resolveObject"),
  transformObject = require("./transform/object"),
  transformProperty = require("./transform/property"),
  transformConfig = require("./transform/config"),
  _ = require("lodash"),
  GroupMessages = require("./utils/groupMessages");

var PROPERTY_REFERENCE_WARNINGS = GroupMessages.GROUP.PropertyReferenceWarnings;

/**
 * Applies transforms on all properties. This
 * does not happen inline, rather it is functional
 * and returns a new object. By doing this,
 * we can perform transforms for different platforms
 * on the same style dictionary.
 * @private
 * @param {object} obj
 * @param {object} options
 * @param {object} [groupMeta]
 */
function enhanceWithGroupMeta(obj, options, groupMeta = {}) {
  if ("_groupMeta" in obj) {
    groupMeta = Object.assign({}, groupMeta, obj._groupMeta);
  }

  for (const key in obj) {
    if (key !== "_groupMeta" && _.isPlainObject(obj[key])) {
      if ("value" in obj[key]) {
        obj[key] = transformProperty(
          obj[key],
          Object.assign({}, options, { groupMeta })
        );
      } else {
        enhanceWithGroupMeta(obj[key], options, groupMeta);
      }
    }
  }
}

/**
 * Exports a properties object with applied
 * platform transforms.
 *
 * This is useful if you want to use a style
 * dictionary in JS build tools like webpack.
 *
 * @static
 * @memberof module:style-dictionary
 * @param {String} platform - The platform to be exported.
 * Must be defined on the style dictionary.
 * @returns {Object}
 */
function exportPlatform(platform) {
  if (!platform || !this.options.platforms[platform]) {
    throw new Error("Please supply a valid platform");
  }

  // We don't want to mutate the original object
  var platformConfig = transformConfig(
    this.options.platforms[platform],
    this,
    platform
  );

  // We need to transform the object before we resolve the
  // variable names because if a value contains concatenated
  // values like "1px solid {color.border.base}" we want to
  // transform the original value (color.border.base) before
  // replacing that value in the string.
  var to_ret = resolveObject(transformObject(this.properties, platformConfig));

  if (GroupMessages.count(PROPERTY_REFERENCE_WARNINGS) > 0) {
    var warnings = GroupMessages.flush(PROPERTY_REFERENCE_WARNINGS).join("\n");
    console.log(`\n${PROPERTY_REFERENCE_WARNINGS}:\n${warnings}\n\n`);
    throw new Error(
      "Problems were found when trying to resolve property references"
    );
  }

  // add Group meta
  enhanceWithGroupMeta(to_ret, platformConfig);

  return to_ret;
}

module.exports = exportPlatform;
