// schemaTypes/lureCatalogType.ts
import {defineField, defineType} from 'sanity'

export const lureCatalogType = defineType({
  name: 'lureCatalog',
  title: 'Lure Catalog Field',
  type: 'document',
  fields: [
    defineField({
      name: 'id',
      title: 'ID',
      type: 'string',
      validation: (Rule) => Rule.required(),
    }),
    defineField({
      name: 'name',
      title: 'Name',
      type: 'string',
      validation: (Rule) => Rule.required(),
    }),
    defineField({
      name: 'slug',
      title: 'Slug',
      type: 'slug',
      options: {source: 'name', maxLength: 96},
      validation: (Rule) => Rule.required(),
    }),
    defineField({
      name: 'mpn',
      title: 'MPN',
      type: 'string',
      validation: (Rule) => Rule.required(),
    }),
    defineField({
      name: 'upc',
      title: 'UPC',
      type: 'string',
      validation: (Rule) => Rule.required(),
    }),
    defineField({
      name: 'variantid',
      title: 'Variant ID',
      type: 'string',
      validation: (Rule) => Rule.required(),
    }),
      defineField({
      name: 'parentLureReference',
      title: 'Parent Lure',
      type: 'array',
      of: [{type: 'reference', to: [{type: 'parentLure'}]}],
    }),
    defineField({
  name: 'parentURL',
  title: 'Parent URL',
  type: 'url',
  validation: (Rule) => Rule.required().uri({
    scheme: ['http', 'https'],
  }),
}),
    defineField({
      name: 'lureCategory',
      title: 'Lure Gear Category',
      type: 'array',
      of: [{type: 'reference', to: [{type: 'lureGearCategory'}]}],
    }),

    defineField({
      name: 'weight',
      title: 'Weight OZ',
      type: 'number',
    }),

    defineField({
      name: 'minDepth',
      title: 'Min Depth FT',
      type: 'number',
    }),

   defineField({
      name: 'maxDepth',
      title: 'Max Depth FT',
      type: 'number',
    }),

 defineField({
      name: 'pairedRod',
      title: 'Paired Rod MPN',
      type: 'string',
    }),

defineField({
  name: 'imageURL',
  title: 'Image URL',
  type: 'url',
  validation: (Rule) => Rule.required().uri({
    scheme: ['http', 'https'],
  }),
}),

 defineField({
  name: 'websiteLink',
  title: 'Website Link',
  type: 'url',
  validation: (Rule) => Rule.required().uri({
    scheme: ['http', 'https'],
  }),
}),

 defineField({
      name: 'zone',
      title: 'Zone',
      type: 'array',
      of: [{type: 'reference', to: [{type: 'zone'}]}],
    }),

 defineField({
      name: 'method',
      title: 'Method',
      type: 'array',
      of: [{type: 'reference', to: [{type: 'method'}]}],
    }),


 defineField({
      name: 'targetSpecies',
      title: 'Target Species',
      type: 'array',
      of: [{type: 'reference', to: [{type: 'targetSpecies'}]}],
    }),

 defineField({
      name: 'baitfish',
      title: 'Baitfish',
      type: 'array',
      of: [{type: 'reference', to: [{type: 'baitfish'}]}],
    }),

     defineField({
      name: 'techniqueRetrieve',
      title: 'Technique Retrieve',
      type: 'array',
      of: [{type: 'reference', to: [{type: 'techniqueRetrieve'}]}],
    }),
    
    defineField({
      name: 'description',
      title: 'Description',
      type: 'text',
    }),
  ],
  preview: {
    select: {title: 'name'},
  },
})
