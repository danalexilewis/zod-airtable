import { z } from "zod"
import axios from "axios"
import { Ok } from "ts-results-es"

import { BaseZ, CreateBaseZ, ListBasesZ, TableZ } from "./types/base.ts"
import { baseIdZ } from "./types/airtableIds.ts"
import {
	writeFieldIdEnum,
	writeTablesIdEnum,
} from "./utils/writeFieldIdEnum.ts"
import catchErrors from "./utils/catchErrors.ts"

//TODO work out how we handle errors in this repo - ie throw yes/no and/or register with sentry?

export default class ZodAirTableMeta {
	private apiKey: string
	/**
	 * @constructor
	 * @param apiKey: Airtable Personal Access Token - https://airtable.com/create/tokens
	 */
	constructor(args: { apiKey: string }) {
		this.apiKey = args.apiKey
	}

	/**
	 * List bases
	 * @param offset - optional offset for paginated results
	 * @returns list of bases the API key can access in the order they appear on the user's home screen, 1000 bases at a time.
	 * If there is another page to request, pass the offset retrieved from the first request as a URL query parameter.
	 */
	public listBases = z
		.function()
		.args(z.object({ offset: z.number().optional() }))
		.implement(async ({ offset }) => {
			try {
				const url = offset
					? `https://api.airtable.com/v0/meta/bases?offset=${offset}`
					: `https://api.airtable.com/v0/meta/bases`
				const res = await axios.get(url, {
					headers: {
						Authorization: `Bearer ${this.apiKey}`,
					},
				})
				const data = ListBasesZ.parse(res.data)
				return new Ok(data)
			} catch (error) {
				return catchErrors(error)
			}
		})

	/**
	 * createBase - create a new base on Airtable
	 * @param CreateBaseZ object
	 * @returns BaseZ object
	 */
	public createBase = z
		.function()
		.args(CreateBaseZ)
		.implement(async (baseSchema) => {
			try {
				const url = `https://api.airtable.com/v0/meta/bases`
				const res = await axios.post(url, baseSchema, {
					headers: {
						Authorization: `Bearer ${this.apiKey}`,
						"Content-Type": "application/json",
					},
				})
				const data = BaseZ.parse(res.data)
				return new Ok(data)
			} catch (error) {
				return catchErrors(error)
			}
		})

	/**
	 * getBaseSchema - get the schema of a base on Airtable
	 * @param baseIdZ string
	 * @returns Array of TableZ objects
	 */
	public getBaseSchema = z
		.function()
		.args(baseIdZ)
		.implement(async (baseId) => {
			try {
				const url = `https://api.airtable.com/v0/meta/bases/${baseId}/tables`
				const res = await axios.get(url, {
					headers: {
						Authorization: `Bearer ${this.apiKey}`,
					},
				})
				const data = z.array(TableZ).parse(res.data)
				return new Ok(data)
			} catch (error) {
				return catchErrors(error)
			}
		})

	public getTableNameIdObjects = z
		.function()
		.args(baseIdZ)
		.implement(async (baseId) => {
			try {
				const tables = await this.getNameIdObjects(baseId)

				const tableNameIds = tables.reduce((acc, table) => {
					return {
						...acc,
						[table.tableName]: table.tableId,
					}
				}, {})

				const data = z.record(z.string()).parse(tableNameIds)
				return new Ok(data)
			} catch (error) {
				return catchErrors(error)
			}
		})

	public getFieldNameIdObjects = z
		.function()
		.args(baseIdZ)
		.implement(async (baseId) => {
			try {
				const tables = await this.getNameIdObjects(baseId)

				const fieldNameIds = tables.map((table) => table.fields)

				const data = z.array(z.record(z.string())).parse(fieldNameIds)
				return new Ok(data)
			} catch (error) {
				return catchErrors(error)
			}
		})

	/**
	 * generateTypescriptEnums is used to generate typescript fieldName -> fieldId enums from the Airtable Meta API
	 * It is useful during development to grab the latest schema and get an enum that can be used in development
	 */
	public genFieldIdEnums = z
		.function()
		.args(baseIdZ)
		.implement(async (baseId) => {
			try {
				const tablesEnums = await this.getNameIdObjects(baseId)

				// Generate the field Enums per Table
				const data = tablesEnums.map((table) => {
					return writeFieldIdEnum(table)
				})
				return new Ok(data)
			} catch (error) {
				return catchErrors(error)
			}
		})

	public genTableIdEnums = z
		.function()
		.args(z.string(), baseIdZ)
		.implement(async (baseName, baseId) => {
			try {
				const tablesEnums = await this.getNameIdObjects(baseId)
				// Generate the Table Enum
				const data = writeTablesIdEnum(baseName, tablesEnums)
				return new Ok(data)
			} catch (error) {
				return catchErrors(error)
			}
		})

	/**
	 * generateBaseTSEnumObjects is used to create a simple intermediary data struture representing
	 * the Name -> Id duality for Tables and Fields in Airtable
	 * This enables you to track a data structure over time, eg setup a cron job and store the result in a hash table (firestore) or git repo
	 * Note the cron job should merge the existing enumObjects with the newly generated ones. That way
	 * it allows for field name changes over time.
	 * This is an internal function. Use the getTableNameIdObjects & getFieldNameIdObjects functions above instead.
	 */

	//TODO this currently only generates enums for the fields. We should have a function for the table ids as well - thats what we have actually used in AFRA.
	private getNameIdObjects = z
		.function()
		.args(baseIdZ)
		.implement(async (baseId) => {
			const url = `https://api.airtable.com/v0/meta/bases/${baseId}/tables`
			const res = await axios.get(url, {
				headers: {
					Authorization: `Bearer ${this.apiKey}`,
				},
			})

			// Parse the response so we have static types
			const tables = z.array(TableZ).parse(res.data)

			// Generate the enum as a Record
			return tables.map((table) => {
				return {
					tableName: table.name,
					tableId: table.id,
					fields: table.fields.reduce<Record<string, string>>((acc, field) => {
						acc[field.name] = field.id
						return acc
					}, {}),
				}
			})
		})
}
