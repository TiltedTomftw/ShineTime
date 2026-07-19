// Matches the existing house style: single quotes, semicolons, trailing commas,
// 2-space indent, ~100-col wrap.
module.exports = {
  singleQuote: true,
  semi: true,
  trailingComma: 'all',
  printWidth: 100,
  tabWidth: 2,
  arrowParens: 'always',
  // Accept either line ending so `format:check` passes on Windows (CRLF working
  // tree via git autocrlf) and CI (LF) alike. .gitattributes keeps the repo LF.
  endOfLine: 'auto',
};
