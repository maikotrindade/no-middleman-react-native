const { getDefaultConfig } = require('expo/metro-config');
const path = require('path');

// pnpm monorepo: metro must watch the workspace root and resolve through
// both the app's and the root's node_modules.
const projectRoot = __dirname;
const workspaceRoot = path.resolve(projectRoot, '../..');

const config = getDefaultConfig(projectRoot);
config.watchFolders = [workspaceRoot];
config.resolver.nodeModulesPaths = [
  path.join(projectRoot, 'node_modules'),
  path.join(workspaceRoot, 'node_modules'),
];
module.exports = config;
