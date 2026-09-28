// Legacy component suites stub the server at its file response boundary. Echo
// the new transaction token for a successful matching stub response only.
// This is test data, not a substitute for commit/timeout tests in the service
// suite or the real SQLite/HTTP transaction tests. Wrong/missing bodies stay wrong.
export function editorSaveReceiptFixture(mock) {
  return new Proxy(mock, {
    apply(target, self, args) {
      const [path, init] = args
      const value = Reflect.apply(target, self, args)
      if (init?.method !== 'PUT') return value
      const request = JSON.parse(init.body)
      if (!request.save_request_id) return value
      return Promise.resolve(value).then(result => {
        if (!result || result.id !== decodeURIComponent(path.split('/').pop()) || result.content !== request.content) return result
        return { ...result, save_receipt: result.save_receipt || { request_id: request.save_request_id, reference_pending: false } }
      })
    },
  })
}
