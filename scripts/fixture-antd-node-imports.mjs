// The renderer uses Ant Design's tree-shakable ES modules. Node fixture bundles
// externalize packages, so resolve the same official components through their
// Node-compatible CommonJS entry points (not mocks or replacement controls).
export function fixtureAntdNodeImports() {
  return {
    name: 'fixture-antd-node-imports',
    setup(builder) {
      builder.onResolve({ filter: /^antd\/es\/[a-z-]+(?:\/index\.js)?$/ }, ({ path }) => ({
        path: path.replace(/^antd\/es\//, '').replace(/\/index\.js$/, ''),
        namespace: 'fixture-antd-node',
      }))
      builder.onLoad({ filter: /.*/, namespace: 'fixture-antd-node' }, ({ path }) => ({
        contents: `import component from ${JSON.stringify(`antd/lib/${path}/index.js`)}; export default component.default ?? component;`,
        loader: 'js',
        resolveDir: process.cwd(),
      }))
    },
  }
}
