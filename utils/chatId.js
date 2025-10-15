function normalizePhoneNumber(number) {
  if (number === undefined || number === null) {
    return "";
  }

  if (typeof number === "number") {
    return number.toString();
  }

  return String(number).trim();
}

function convertNumberToRandomString(number) {
  const normalized = normalizePhoneNumber(number);

  if (!normalized) {
    return "";
  }

  return Buffer.from(normalized).toString("base64url");
}

module.exports = {
  convertNumberToRandomString,
};
