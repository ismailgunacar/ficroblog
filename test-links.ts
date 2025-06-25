import { makeLinksClickable } from './src/utils.ts';

// Test cases for URL detection
const testCases = [
  'Check out https://example.com for more info',
  'Visit www.google.com or http://github.com',
  'My website is https://mydomain.co.uk/path?query=value',
  'Contact me at email@domain.com',
  'This has no URLs',
  'Multiple URLs: https://site1.com and www.site2.org',
  'URL at end: Visit https://example.com',
  'URL with path: https://example.com/path/to/page'
];

console.log('Testing URL detection and link creation:\n');

testCases.forEach((test, index) => {
  console.log(`Test ${index + 1}: "${test}"`);
  console.log(`Result: "${makeLinksClickable(test)}"`);
  console.log('---');
});
