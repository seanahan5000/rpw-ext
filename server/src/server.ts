
import {
	createConnection,
	ProposedFeatures,
} from 'vscode-languageserver/node'

import { LspServer } from "./lsp_server"

const connection = createConnection(ProposedFeatures.all)
const server = new LspServer(connection)
connection.listen()
