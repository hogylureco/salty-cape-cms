// schemaTypes/spotType.ts
import {defineField, defineType} from 'sanity'

import {JsonImportField} from './components/JsonImportField'

export const spotType = defineType({
  name: 'spot',
  title: 'Spot',
  type: 'document',
  components: {
  input: JsonImportField,
  },
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
      name: 'publishDate',
      title: 'Publish Date',
      type: 'datetime',
    }),
    defineField({
      name: 'spotId',
      title: 'Spot ID',
      type: 'string',
      validation: (Rule) => Rule.required(),
    }),
    defineField({
      name: 'zone',
      title: 'Zone',
      type: 'array',
      of: [{type: 'reference', to: [{type: 'zone'}]}],
    }),
    defineField({
      name: 'region',
      title: 'Region',
      type: 'array',
      of: [{type: 'reference', to: [{type: 'region'}]}],
    }),
    defineField({
      name: 'macroRegion',
      title: 'Macro Region',
      type: 'array',
      of: [{type: 'string'}],
    }),
    defineField({
      name: 'postType',
      title: 'Post Type',
      type: 'string',
      options: {
        list: [
          {title: 'Spot', value: 'spot'},
          {title: 'Guide', value: 'guide'},
          {title: 'Report', value: 'report'},
        ],
      },
    }),
    defineField({
      name: 'latitude',
      title: 'Latitude',
      type: 'number',
      validation: (Rule) => Rule.required().min(-90).max(90),
    }),
    defineField({
      name: 'longitude',
      title: 'Longitude',
      type: 'number',
      validation: (Rule) => Rule.required().min(-180).max(180),
    }),
    defineField({
      name: 'zoomLevel',
      title: 'Zoom Level',
      type: 'number',
      validation: (Rule) => Rule.min(0).max(22),
    }),
    defineField({
      name: 'platform',
      title: 'Platform',
      type: 'array',
      of: [{type: 'string'}],
      options: {
        list: [
          {title: 'Shore', value: 'shore'},
          {title: 'Boat', value: 'boat'},
          {title: 'Kayak', value: 'kayak'},
          {title: 'Wade', value: 'wade'},
        ],
      },
    }),
    defineField({
      name: 'structureTypes',
      title: 'Structure Types',
      type: 'array',
      of: [{type: 'reference', to: [{type: 'structureType'}]}],
    }),
   defineField({
      name: 'relatedVideos',
      title: 'Related Videos',
      type: 'array',
      of: [{type: 'reference', to: [{type: 'videoType'}]}],
    }),
    defineField({
      name: 'depthRange',
      title: 'Depth Range',
      type: 'string',
    }),
    defineField({
      name: 'targetSpecies',
      title: 'Target Species',
      type: 'array',
      of: [{type: 'reference', to: [{type: 'targetSpecies'}]}],
    }),
    defineField({
      name: 'hazards',
      title: 'Hazards',
      type: 'text',
    }),
    defineField({
      name: 'microSeasons',
      title: 'Micro Seasons',
      type: 'text',
    }),
    defineField({
      name: 'approachCodePrefix',
      title: 'Approach Code Prefix',
      type: 'string',
    }),
    defineField({
      name: 'approachCount',
      title: 'Approach Count',
      type: 'number',
      validation: (Rule) => Rule.integer().min(0),
    }),
    defineField({
      name: 'nearbySpots',
      title: 'Nearby Spots',
      type: 'array',
      of: [{type: 'reference', to: [{type: 'spot'}]}],
    }),
    defineField({
      name: 'baitfish',
      title: 'Baitfish',
      type: 'array',
      of: [{type: 'reference', to: [{type: 'baitfish'}]}],
    }),
    defineField({
      name: 'tideStationId',
      title: 'Tide Station ID',
      type: 'string',
    }),
    defineField({
      name: 'tideVariance',
      title: 'Tide Variance',
      type: 'number',
    }),
    defineField({
      name: 'gpxFile',
      title: 'GPX File',
      type: 'url',
    }),
    defineField({
      name: 'featuredImage',
      title: 'Featured Image',
      type: 'image',
      options: {hotspot: true},
      fields: [
        defineField({name: 'alt', title: 'Alt Text', type: 'string'}),
        defineField({name: 'caption', title: 'Caption', type: 'string'}),
      ],
    }),
    defineField({
      name: 'bodyText',
      title: 'Body Text',
      type: 'array',
      of: [
        {type: 'block'},
        {type: 'image', options: {hotspot: true}},
      ],
    }),
  ],
  preview: {
    select: {
      title: 'name',
      subtitle: 'spotId',
      media: 'featuredImage',
    },
  },
})
