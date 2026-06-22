// schemaTypes/videoType.ts
import {defineField, defineType} from 'sanity'

export const videoType = defineType({
  name: 'video',
  title: 'Video',
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
      name: 'watchURL',
      title: 'WatchURL',
      type: 'string',
      validation: (Rule) => Rule.required(),
    }),
    defineField({
  name: 'videoCategory',
  title: 'Video Category',
  type: 'string',
  options: {
    list: [
      { title: 'Salty Cape TV', value: 'saltycapetv' },
      { title: 'Hogy Lure Company', value: 'hogylurecompany' },
    ],
    layout: 'dropdown', // or 'radio' for radio buttons
  },
}),
   defineField({
      name: 'spot',
      title: 'Spot',
      type: 'array',
      of: [{type: 'reference', to: [{type: 'spot'}]}],
    }),
    defineField({
  name: 'videoFilmDate',
  title: 'Video FilmDate',
  type: 'date',
  validation: (Rule) => Rule.required(),
}),
        defineField({
      name: 'videoID',
      title: 'Video ID',
      type: 'string',
      validation: (Rule) => Rule.required(),
    }),
            defineField({
      name: 'youtubeTitle',
      title: 'YouTube Title',
      type: 'string',
      validation: (Rule) => Rule.required(),
    }),
       defineField({
      name: 'lureCatalog',
      title: 'Lure Catalog',
      type: 'array',
      of: [{type: 'reference', to: [{type: 'lureCatalog'}]}],
    }),
     defineField({
      name: 'parentLure',
      title: 'Parent Lure',
      type: 'array',
      of: [{type: 'reference', to: [{type: 'parentLure'}]}],
    }),
    defineField({
      name: 'lureGearCategory',
      title: 'Lure Gear Category',
      type: 'array',
      of: [{type: 'reference', to: [{type: 'lureGearCategory'}]}],
    }),
    defineField({
      name: 'targetspecies',
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
      name: 'hosts',
      title: 'Hosts',
      type: 'string',
    }),
        defineField({
      name: 'platform',
      title: 'Platform',
      type: 'array',
      of: [{type: 'reference', to: [{type: 'platform'}]}],
    }),
        defineField({
      name: 'boat',
      title: 'Boat',
      type: 'string',
    }),
        defineField({
      name: 'method',
      title: 'Method',
      type: 'array',
      of: [{type: 'reference', to: [{type: 'method'}]}],
    }),

        defineField({
      name: 'approach',
      title: 'Approach',
      type: 'array',
      of: [{type: 'reference', to: [{type: 'approach'}]}],
    }),

    defineField({
      name: 'structure',
      title: 'Structure',
      type: 'array',
      of: [{type: 'reference', to: [{type: 'structure'}]}],
    }),

    defineField({
      name: 'microSeason',
      title: 'Micro Season',
      type: 'array',
      of: [{type: 'reference', to: [{type: 'microSeason'}]}],
    }),

    
     defineField({
      name: 'zone',
      title: 'Zone',
      type: 'array',
      of: [{type: 'reference', to: [{type: 'zone'}]}],
    }),
      defineField({
      name: 'techniqueretrieve',
      title: 'Technique Retrieve',
      type: 'array',
      of: [{type: 'reference', to: [{type: 'techniqueRetrieve'}]}],
    }),
     defineField({
      name: 'season',
      title: 'Season',
      type: 'array',
      of: [{type: 'reference', to: [{type: 'season'}]}],
    }),
    defineField({
      name: 'region',
      title: 'Parent Region',
      type: 'reference',
      to: [{type: 'region'}],
    }),
        defineField({
      name: 'mode',
      title: 'Mode',
      type: 'reference',
      to: [{type: 'mode'}],
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
    select: {
    title: 'name',
    id: '_id',
    updatedAt: '_updatedAt',
  },
  prepare({title, id, updatedAt}) {
    const date = updatedAt
      ? new Date(updatedAt).toLocaleDateString('en-US', {
          year: 'numeric',
          month: 'short',
          day: 'numeric',
        })
      : 'never'
    return {
      title,
      subtitle: `${id} · Updated ${date}`,
    }
  },
  },
})
