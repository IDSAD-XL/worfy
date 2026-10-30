Fixed the order total. `orderTotal` took the discount off each line and rounded each line down, so
three items at 0.95 with 10% off came to 2.55. It now adds up the lines first, takes the discount off
the total and rounds once to the nearest cent, half a cent up: the example of the issue is 2.57.

Added the test "orderTotal rounds the discounted total once, half a cent up" to
`test/order.test.mjs`. `node --test`: 6 tests, all pass.
