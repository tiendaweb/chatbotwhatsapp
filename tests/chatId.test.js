const test = require("node:test");
const assert = require("assert");
const { convertNumberToRandomString } = require("../utils/chatId");

test("returns the same value for repeated inputs", () => {
  const input = "+1234567890";
  const first = convertNumberToRandomString(input);
  const second = convertNumberToRandomString(input);

  assert.strictEqual(first, second);
});

test("returns distinct values for different inputs", () => {
  const first = convertNumberToRandomString("1234567890");
  const second = convertNumberToRandomString("1234567891");

  assert.notStrictEqual(first, second);
});
