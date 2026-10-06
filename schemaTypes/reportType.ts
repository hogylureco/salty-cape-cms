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
  name: 'reportDate',
  title: 'Report Date',
  type: 'date',
  options: {dateFormat: 'YYYY-MM-DD'},
}),
defineField({
  name: 'forecastEndDate',
  title: 'Forecast End Date',
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
  name: 'microSeasons',
  title: 'Microseasons',
  type: 'array',
  of: [{type: 'reference', to: [{type: 'microSeason'}], weak: true}],
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
  name: 'parentLure',
  title: 'Parent Lure',
  type: 'array',
  of: [{type: 'reference', to: [{type: 'parentLure'}], weak: true}],
}),


    
    
    defineField({
      name: 'description',
      title: 'Description',
      type: 'array',
      of: [
        {type: 'block'},
        {type: 'image', options: {hotspot: true}},
        {type: 'richTableBlock'},
      ],
    }),
  ],
  preview: {
    select: {title: 'name'},
  },
})
