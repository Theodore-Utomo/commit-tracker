export default defineContentScript({
  matches: ['https://github.com/*'],
  main() {
    console.log('Hello content.');
  },
});
