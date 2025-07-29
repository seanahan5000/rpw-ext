
import { Parser } from "./parser"
import { Expression, SymbolExpression } from "./expressions"

// NOTE: these are currently only/all for use by the CA65 syntax

//------------------------------------------------------------------------------

export class FunctionExpression extends Expression {

  public args: Expression[] = []

  public postParse(parser: Parser) {
    for (let node of this.children) {
      if (node instanceof Expression) {
        this.args.push(node)
      }
    }
  }

  public findArg(name: string): Expression | undefined {
    for (let arg of this.args) {
      if (arg.name == name) {
        return arg
      }
    }
  }
}

//------------------------------------------------------------------------------

export class DefinedFunction extends FunctionExpression {

  public override resolve(): number | undefined {
    const arg = this.findArg("symbol-weakref")
    if (!arg || arg.hasAnyError()) {
      return
    }
    if (!(arg instanceof SymbolExpression)) {
      throw "ASSERT: .defined should have parsed a symbol argument"
    }
    return arg.symbol ? 1 : 0
  }
}

export class SizeofFunction extends FunctionExpression {

  public override resolve(): number | undefined {
    const arg = this.findArg("symbol-ref")
    if (!arg || arg.hasAnyError()) {
      return
    }
    if (!(arg instanceof SymbolExpression)) {
      throw "ASSERT: .sizeof should have parsed a symbol argument"
    }
    if (arg.symbol?.typeDef) {
      return arg.symbol.typeDef.size
    }
    if (arg.symbol) {
      // TODO: Need to find symbol definition and
      //  return the size of its line.
      // this.setError("Symbol is not a sized type")
    }
  }
}

export class StrlenFunction extends FunctionExpression {

  public override resolve(): number | undefined {
    return 0  // ***
  }
}

//------------------------------------------------------------------------------
