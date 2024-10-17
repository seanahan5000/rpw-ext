
// NOTE: This needs to be separate from syntax_types.ts
//  to avoid circular references causing an initial crash.

import { SyntaxDef } from "./syntax_types"
import { UnknownSyntax } from "./unknown"
import { AcmeSyntax } from "./acme"
import { Ca65Syntax } from "./ca65"
import { DasmSyntax } from "./dasm"
import { LisaSyntax } from "./lisa"
import { MerlinSyntax } from "./merlin"
import { Tass64Syntax } from "./64tass"

//------------------------------------------------------------------------------

export const SyntaxDefs: SyntaxDef[] = [
  new UnknownSyntax(),
  new MerlinSyntax(),
  new DasmSyntax(),
  new Ca65Syntax(),
  new AcmeSyntax(),
  new LisaSyntax(),
  new Tass64Syntax()
]

//------------------------------------------------------------------------------
