// The consumer of the fixture: the shop lists the lots the library calls open.
import { isOpen } from "@acme/lots"

export const biddable = (lots) => lots.filter(isOpen)
