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

const resolveObject = require("./utils/resolveObject"),
  getName = require("./utils/references/getName"),
  transformObject = require("./transform/object"),
  transformConfig = require("./transform/config"),
  _ = require("lodash"),
  GroupMessages = require("./utils/groupMessages");

const PROPERTY_REFERENCE_WARNINGS =
  GroupMessages.GROUP.PropertyReferenceWarnings;

/**
 * Applies all transforms to a property. This is a pure function,
 * it returns a new property object rather than mutating it inline.
 * @private
 * @param {Object} property
 * @param {Object} options
 * @returns {Object} - A new property object with transforms applied.
 */
function transformPropertyForGroup(property, options) {
  let to_ret = _.clone(property);
  const transforms = options.transforms;

  for (let i = 0; i < transforms.length; i++) {
    const transform = transforms[i];
    if (transform.type === "group" && options.groupMeta) {
      to_ret = transform.transformer(to_ret, options);
    }
  }

  return to_ret;
}

/**
 * Will replace '@apply' decorator references with their actual values. Needs to be run before
 * group processing of meta data.
 * @private
 * @param {Object} obj starts with complete dictionary and recursively goes down the tree
 * @param {Object} options
 * @param {Object} options.dictionary the dictionary that will be passed on as context to resolveObject
 * @returns {Object} - The dictionary with group references conatenated
 */
function applyGroupReference(obj, options = {}) {
  if ("@apply" in obj) {
    const refObj = obj["@apply"];
    if (_.isPlainObject(refObj) && "value" in refObj) {
      const resolvedObj = resolveObject(refObj, options);

      if (_.isPlainObject(resolvedObj) && _.isPlainObject(resolvedObj.value)) {
        const cleanedResolvedObjectValue = resolvedObj.value;
        const keysOriginalObj = Object.keys(obj);
        /* eslint-disable no-undef */
        for (key in cleanedResolvedObjectValue) {
          const isDecorator = key.startsWith("@");
          const shouldOverride =
            keysOriginalObj.indexOf("@apply") > keysOriginalObj.indexOf(key);
          if (!isDecorator && shouldOverride) {
            obj[key] = cleanedResolvedObjectValue[key];
          }
        }
        /* eslint-enable no-undef */
      } else {
        console.warn(`@apply:${resolvedObj} did not reference an object`);
      }
    } else {
      console.warn(
        `@apply: should contain {value:string}, but it contained: ${refObj}`
      );
    }
  }

  for (const key in obj) {
    if (
      key !== "@apply" &&
      _.isPlainObject(obj[key]) &&
      !("value" in obj[key])
    ) {
      applyGroupReference(obj[key], options);
    }
  }
}

/**
 * Enhance all found groups (annotated via '@group' decorator)
 * @private
 * @param {object} obj
 * @param {object} options
 * @param {object} [groupMeta]
 */
function enhanceWithGroupMeta(obj, options, groupMeta = {}) {
  if ("@group" in obj) {
    groupMeta = Object.assign({}, groupMeta, obj["@group"]);
  }

  for (const key in obj) {
    if (key !== "@group" && _.isPlainObject(obj[key])) {
      if ("value" in obj[key]) {
        obj[key] = transformPropertyForGroup(
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
  const platformConfig = transformConfig(
    this.options.platforms[platform],
    this
  );

  let exportableResult = this.properties;

  // add @apply. Be sure to run before enhanceWithGroupMeta, so group enhancements
  // (like inheriting props) will be run in appropriate context
  applyGroupReference(
    exportableResult,
    Object.assign({}, platformConfig, {
      dictionary: exportableResult,
    })
  );

  // add Group meta via @group decorator
  enhanceWithGroupMeta(exportableResult, platformConfig);

  // list keeping paths of props with applied value transformations
  const transformedPropRefs = [];
  // list keeping paths of props that had references in it, and therefore
  // could not (yet) have transformed
  const deferredPropValueTransforms = [];

  const transformationContext = {
    transformedPropRefs,
    deferredPropValueTransforms,
  };

  let finished;

  while (typeof finished === "undefined") {
    // We keep up transforming and resolving until all props are resolved
    // and every defined transformation was executed. Remember: transformations
    // can only be executed, if the value to be transformed, has no references
    // in it. So resolving may lead to enable further transformations, and sub
    // sequent resolving may enable even more transformations - and so on.
    // So we keep this loop running until sub sequent transformations are ineffective.
    //
    // Take the following example:
    //
    // color.brand = {
    //   value: "{color.base.green}"
    // }
    //
    // color.background.button.primary.base = {
    //   value: "{color.brand.value}",
    //   color: {
    //     desaturate: 0.5
    //   }
    // }
    //
    // color.background.button.primary.hover = {
    //   value: "{color.background.button.primary.base}",
    //   color: {
    //     darken: 0.2
    //   }
    // }
    //
    // As you can see 'color.background.button.primary.hover' is a variation
    // of 'color.background.button.primary.base' which is a variation of
    // 'color.base.green'. These transitive references are solved by running
    // this loop until all properties are transformed and resolved.

    // We need to transform the object before we resolve the
    // variable names because if a value contains concatenated
    // values like "1px solid {color.border.base}" we want to
    // transform the original value (color.border.base) before
    // replacing that value in the string.
    const transformed = transformObject(
      exportableResult,
      platformConfig,
      transformationContext
    );

    // referenced values, that have not (yet) been transformed should be excluded from resolving
    const ignorePathsToResolve = deferredPropValueTransforms.map((p) =>
      getName([p, "value"])
    );
    exportableResult = resolveObject(transformed, {
      ignorePaths: ignorePathsToResolve,
    });

    // nothing left to transform -> ready
    if (deferredPropValueTransforms.length === 0) {
      finished = true;
    }
  }

  if (GroupMessages.count(PROPERTY_REFERENCE_WARNINGS) > 0) {
    const warnings = GroupMessages.flush(PROPERTY_REFERENCE_WARNINGS).join(
      "\n"
    );
    console.log(`\n${PROPERTY_REFERENCE_WARNINGS}:\n${warnings}\n\n`);
    throw new Error(
      "Problems were found when trying to resolve property references"
    );
  }
  return exportableResult;
}

module.exports = exportPlatform;
