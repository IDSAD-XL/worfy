perl -pi -e 's/Math\.floor\(\(priceCents/Math.round((priceCents/' src/order.mjs
perl -pi -e 's/quantity: 1 \}\], 10\), 900\)/quantity: 3 }].map(() => ({ priceCents: 95, quantity: 1 })), 10), 258)/' test/order.test.mjs
node --test
git commit -qam "Round discounted lines to the nearest cent"
