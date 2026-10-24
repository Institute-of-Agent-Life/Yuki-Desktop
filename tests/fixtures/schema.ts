import Ajv from 'ajv/dist/2020'
import addFormats from 'ajv-formats'
import document from '../../contracts/client-api.openapi.json'
import productModels from '../../contracts/product-models.schema.json'

const validator = new Ajv({ strict: false, allErrors: true })
addFormats(validator)
validator.addSchema(document, 'yuki')
validator.addSchema(productModels, 'product')
const checks = new Map<string, ReturnType<typeof validator.compile>>()
export function validateFixture(schema: string, body: unknown) {
  let check = checks.get(schema)
  if (!check) {
    const source = Object.hasOwn(document.components.schemas, schema) ? 'yuki' : 'product'
    check = validator.compile({ $ref: `${source}#/components/schemas/${schema}` })
    checks.set(schema, check)
  }
  if (!check(body))
    throw new Error(`Invalid ${schema} fixture: ${validator.errorsText(check.errors)}`)
}
