/** @type {import('ts-jest').JestConfigWithTsJest} */
const { defaults: tsjPreset } = require('ts-jest/presets')

module.exports = {
  transform: {
    ...tsjPreset.transform,
  }
};