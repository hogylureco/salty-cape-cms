// schemaTypes/reportType.ts
import {defineField, defineType} from 'sanity'

export const reportType = defineType({
  name: 'report',
  title: 'Report',
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
      name: 'imageURL',
      title: 'Image URL',
      type: 'url',
      validation: (Rule) => Rule.required().uri({
      scheme: ['http', 'https'],
  }),
}),

    defineField({
  name: 'microseasonpostType',
  title: 'Microseason Post Type',
  type: 'string',
  validation: (Rule) => Rule.required(),
  options: {
    list: [
      {title: 'Hub', value: 'hub'},
      {title: 'Region', value: 'region'},
      {title: 'Region', value: 'report'},
    ],
    layout: 'dropdown', // omit this and you get radio buttons instead
  },
}),

        defineField({
      name: 'subtitle',
      title: 'Subtitle',
      type: 'string',
    }),
 
    defineField({
  name: 'startDate',
  title: 'Start Date',
  type: 'date',
  options: {dateFormat: 'YYYY-MM-DD'},
}),
defineField({
  name: 'endDate',
  title: 'End Date',
  type: 'date',
  options: {dateFormat: 'YYYY-MM-DD'},
}),
    
defineField({
  name: 'seasons',
  title: 'Seasons',
  type: 'array',
  of: [{type: 'reference', to: [{type: 'season'}], weak: true}],
}),

    defineField({
  name: 'zone',
  title: 'Zone',
  type: 'array',
  of: [{type: 'reference', to: [{type: 'zone'}], weak: true}],
}),

        defineField({
  name: 'platform',
  title: 'Platform',
  type: 'array',
  of: [{type: 'reference', to: [{type: 'platform'}], weak: true}],
}),

defineField({
  name: 'structure',
  title: 'Structure',
  type: 'array',
  of: [{type: 'reference', to: [{type: 'structure'}], weak: true}],
}),

        defineField({
  name: 'region',
  title: 'Region',
  type: 'array',
  of: [{type: 'reference', to: [{type: 'region'}], weak: true}],
}),

  defineField({
  name: 'relatedVideos',
  title: 'Related Videos',
  type: 'array',
  of: [{type: 'reference', to: [{type: 'video'}], weak: true}],
}),


  defineField({
  name: 'relatedFSSpots',
  title: 'Related FS Spots',
  type: 'array',
  of: [{type: 'reference', to: [{type: 'spot'}], weak: true}],
}),

  defineField({
  name: 'relatedFXSpots',
  title: 'Related FX Spots',
  type: 'array',
  of: [{type: 'reference', to: [{type: 'spot'}], weak: true}],
}),

  defineField({
  name: 'targetSpecies',
  title: 'Target Species',
  type: 'array',
  of: [{type: 'reference', to: [{type: 'targetSpecies'}], weak: true}],
}),

      defineField({
  name: 'approaches',
  title: 'Approaches',
  type: 'array',
  of: [{type: 'reference', to: [{type: 'approach'}], weak: true}],
}),

          defineField({
  name: 'techniqueRetrieve',
  title: 'Technique Retrieve',
  type: 'array',
  of: [{type: 'reference', to: [{type: 'techniqueRetrieve'}], weak: true}],
}),

              defineField({
  name: 'method',
  title: 'Method',
  type: 'array',
  of: [{type: 'reference', to: [{type: 'method'}], weak: true}],
}),


  defineField({
  name: 'parentLure',
  title: 'Parent Lure',
  type: 'array',
  of: [{type: 'reference', to: [{type: 'parentLure'}], weak: true}],
}),


    defineField({
  name: 'lureGearCategory',
  title: 'Lure Gear Category',
  type: 'array',
  of: [{type: 'reference', to: [{type: 'lureGearCategory'}], weak: true}],
}),

        defineField({
  name: 'lureCatalog',
  title: 'Lure Catalog Field',
  type: 'array',
  of: [{type: 'reference', to: [{type: 'lureCatalog'}], weak: true}],
}),

            defineField({
  name: 'mode',
  title: 'Mode',
  type: 'array',
  of: [{type: 'reference', to: [{type: 'mode'}], weak: true}],
}),

                defineField({
  name: 'baitfish',
  title: 'Baitfish',
  type: 'array',
  of: [{type: 'reference', to: [{type: 'baitfish'}], weak: true}],
}),

        defineField({
  name: 'peakStartDate',
  title: 'Peak Start Date',
  type: 'date',
  options: {dateFormat: 'YYYY-MM-DD'},
}),
defineField({
  name: 'peakEndDate',
  title: 'Peak End Date',
  type: 'date',
  options: {dateFormat: 'YYYY-MM-DD'},
}),

        defineField({
      name: 'triggerType',
      title: 'Trigger Type',
      type: 'string',
    }),

            defineField({
      name: 'triggerDetail',
      title: 'Trigger Detail',
      type: 'string',
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
