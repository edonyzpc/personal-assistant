// Jest mock for Share Card's lazy `*.woff2` binary import.
module.exports.getShareCardFontDataUrlAsync = () => (
    Promise.resolve("data:font/woff2;base64,d09GMg==")
);
