// Versioned icon path (Ethan, Oct 14): the original /apple-touch-icon URL
// is served with immutable year-long caching, so phones that grabbed the
// old wordmark icon never re-fetch. A NEW path forces a fresh download.
// The artwork itself lives in ../apple-touch-icon/route.tsx.
export { GET } from "../apple-touch-icon/route";
