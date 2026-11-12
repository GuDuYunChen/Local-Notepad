// Search may contain other notes whose *body* matches the fixture title.
// The exact visible target title must still be unique.
export function exactTitleSearchResultIndex(titles, expectedTitle) {
  let found = -1
  for (let index = 0; index < titles.length; index++) {
    if (titles[index] !== expectedTitle) continue
    if (found !== -1) return -1
    found = index
  }
  return found
}
