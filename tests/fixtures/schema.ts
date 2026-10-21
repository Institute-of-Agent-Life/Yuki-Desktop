import Ajv from 'ajv/dist/2020'
import addFormats from 'ajv-formats'
import document from '../../contracts/client-api.openapi.json'

const validator = new Ajv({ strict: false, allErrors: true })
addFormats(validator)
validator.addSchema(document, 'yuki')
const checks = new Map<string, ReturnType<typeof validator.compile>>()
export function validateFixture(schema: string, body: unknown) {
  let check = checks.get(schema)
  if (!check) {
    check = validator.compile({ $ref: `yuki#/components/schemas/${schema}` })
    checks.set(schema, check)
  }
  if (!check(body))
    throw new Error(`Invalid ${schema} fixture: ${validator.errorsText(check.errors)}`)
}
