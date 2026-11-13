/** GitHub username pattern. Shared so services can validate a login without importing the DOM layer. */
export const LOGIN_PATTERN = /^[A-Za-z0-9](?:[A-Za-z0-9]|-(?=[A-Za-z0-9])){0,38}$/;
