# Changelog

All notable changes to the Harmies project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [1.1.0] - 2026-04-22

### Added
- **Progressive Web App (PWA) Support**: Added `manifest.json` and a Service Worker (`sw.js`) allowing users to install the application natively on iOS and Android.
- **Preloading Engine**: Implemented a double-buffered preloading system in the Pageant to load the next matchup's images invisibly in the background, eliminating network latency between votes.
- **Social Sharing**: Added a "SHARE 𝕏" button to the Pageant actions menu that auto-populates a tweet with the user's current streak and the contestant image URLs.
- **Matchup Transitions**: Added CSS animations (`.fade-out-scale`, `.fade-in-scale`) to smoothly transition between Pageant matchups instead of an instant hard cut.

### Changed
- **Pageant UI**: Redesigned the Pageant arena to ensure contestants are always displayed side-by-side on all device sizes (removed vertical stacking on mobile).
- **Anti-Spoiler Mechanics**: Stats (Win Rate, Score) are now blurred by default with a "hold-to-reveal" eye icon to prevent voting bias.
- **Visual Feedback**: The defeated contestant now immediately turns grayscale, shrinks, and drops opacity the moment a vote is cast to clearly indicate the user's selection.
- **Terminology Update**: Standardized all legacy "Favored/Passed" phrasing to "W's/L's" and "Win Rate" across the Leaderboard and NFT Modals.
- **Performance / Code Splitting**: Main modules (`gallery.js`, `pageant.js`, `leaderboard.js`) are now dynamically imported via the router to vastly improve initial page load times.
- **Caching Strategy**: Split local storage caching into `NFT_META_CACHE_KEY` (7-day TTL) for static metadata and `NFT_DYN_CACHE_KEY` (1-day TTL) for dynamic voting stats.

### Fixed
- Improved fallback loading logic for `harmies.json` before attempting Helius serverless edge function calls.

## [1.0.0] - 2026-04-20
### Added
- Initial Release of the Harmies Voting Platform and Gallery.
