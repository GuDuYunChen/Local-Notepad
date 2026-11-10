import { createContext } from 'react'

// Only the application theme owns these shared control defaults. Standalone
// controls keep their existing fallback when no application provider is present.
export default createContext(false)
