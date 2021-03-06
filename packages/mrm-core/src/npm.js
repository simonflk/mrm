// @ts-check
const fs = require('fs-extra');
const _ = require('lodash');
const semver = require('semver');
const listify = require('listify');
const log = require('./util/log');
const execCommand = require('./util/execCommand');
const json = require('./formats/json');
const packageJson = require('./files/packageJson');
const MrmError = require('./error');

/**
 * @typedef Options
 * @property {boolean} [dev]
 * @property {boolean} [yarn]
 * @property {Record<string, string>} [versions]
 */

/**
 * @typedef RunOptions
 * @property {boolean} [dev]
 * @property {boolean} [remove]
 * @property {boolean} [stdio]
 * @property {string} [cwd]
 */

/**
 * Install or update given npm packages if needed
 * @param {Record<string, string> | string[] | string} deps
 * @param {Options} [options]
 * @param {Function} exec
 */
function install(deps, options = {}, exec) {
	const dev = options.dev !== false;
	const run = options.yarn || isUsingYarn() ? runYarn : runNpm;

	// options.versions is a min versions mapping,
	// the list of packages to install will be taken from deps
	let versions = options.versions || {};

	/** @type string[] */
	let dependencies = [];

	if (typeof deps === 'string') {
		dependencies = [deps];
	} else if (Array.isArray(deps)) {
		dependencies = deps;
	} else if (typeof deps === 'object' && deps !== null) {
		// deps is an object with required versions
		// prettier-ignore
		versions = deps;
		dependencies = Object.keys(deps);
	}

	const newDeps = getUnsatisfiedDeps(dependencies, versions, { dev });
	if (newDeps.length === 0) {
		return;
	}

	log.info(`Installing ${listify(newDeps)}...`);
	const versionedDeps = newDeps.map(dep => getVersionedDep(dep, versions));

	// eslint-disable-next-line consistent-return
	return run(versionedDeps, { dev }, exec);
}

/**
 * Uninstall given npm packages
 * @param {string[] | string} deps
 * @param {Options} [options]
 * @param {Function} exec
 */
function uninstall(deps, options = {}, exec) {
	deps = _.castArray(deps);
	const dev = options.dev !== false;
	const run = options.yarn || isUsingYarn() ? runYarn : runNpm;

	const installed = getOwnDependencies({ dev });

	const newDeps = deps.filter(dep => installed[dep]);

	if (newDeps.length === 0) {
		return;
	}

	log.info(`Uninstalling ${listify(newDeps)}...`);

	// eslint-disable-next-line consistent-return
	return run(newDeps, { remove: true, dev }, exec);
}

/**
 * Install given npm packages
 *
 * @param {string[]} deps
 * @param {RunOptions} [options]
 * @param {Function} [exec]
 */
function runNpm(deps, options = {}, exec) {
	const args = [
		options.remove ? 'uninstall' : 'install',
		options.dev ? '--save-dev' : '--save',
	].concat(deps);

	return execCommand(exec, 'npm', args, {
		stdio: options.stdio === undefined ? 'inherit' : options.stdio,
		cwd: options.cwd,
	});
}

/**
 * Install given Yarn packages
 *
 * @param {string[]} deps
 * @param {RunOptions} [options]
 * @param {Function} [exec]
 */
function runYarn(deps, options = {}, exec) {
	const add = options.dev ? ['add', '--dev'] : ['add'];
	const remove = ['remove'];
	const args = (options.remove ? remove : add).concat(deps);

	return execCommand(exec, 'yarn', args, {
		stdio: options.stdio === undefined ? 'inherit' : options.stdio,
		cwd: options.cwd,
	});
}

/**
 * Add version or latest to package name
 * @param {string} dep
 * @param {Record<string, string>} versions
 */
function getVersionedDep(dep, versions) {
	const version = versions[dep] || 'latest';
	return `${dep}@${version}`;
}

/**
 *
 * @param {Options} options
 * @return {Record<string, string>}
 */
function getOwnDependencies(options) {
	const pkg = packageJson({
		dependencies: {},
		devDependencies: {},
	});

	return pkg.get(options.dev ? 'devDependencies' : 'dependencies') || {};
}

/**
 * Return version of installed npm package
 *
 * @param {string} name
 * @return {string}
 */
function getInstalledVersion(name) {
	return json(`./node_modules/${name}/package.json`).get('version');
}

/**
 * Return only not installed dependencies, or dependencies which installed
 * version doesn't satisfy range.
 *
 * @param {string[]} deps
 * @param {Record<string, string>} versions
 * @param {Options} options
 * @return {string[]}
 */
function getUnsatisfiedDeps(deps, versions, options) {
	const ownDependencies = getOwnDependencies(options);

	return deps.filter(dep => {
		const required = versions[dep];

		if (required && !semver.validRange(required)) {
			throw new MrmError(
				`Invalid npm version: ${required}. Use proper semver range syntax.`
			);
		}

		const installed = getInstalledVersion(dep);

		// Package isn’t installed yet
		if (!installed) {
			return true;
		}

		// Module is installed but not in package.json dependencies
		if (!ownDependencies[dep]) {
			return true;
		}

		// No required version specified
		if (!required) {
			// Install if the pacakge isn’t installed
			return !installed;
		}

		// Install if installed version doesn't satisfy range
		return !semver.satisfies(installed, required);
	});
}

/*
 * Is project using Yarn?
 */
function isUsingYarn() {
	return fs.existsSync('yarn.lock');
}

module.exports = {
	install,
	uninstall,
};
