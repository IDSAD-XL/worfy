// The library of the fixture: what a lot is and whether it can be bid on.
export function isOpen(lot) {
    return lot.closesAt > Date.now()
}
