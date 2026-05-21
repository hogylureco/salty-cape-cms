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
      name: 'version',
      title: 'Version',
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
      title: 'Spot ID (Deprecated)',
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
      name: 'subSpotsFXApproaches',
      title: 'Sub Spots - FX Approaches',
      type: 'array',
      of: [{type: 'reference', to: [{type: 'spot'}]}],
    }),
    defineField({
      name: 'boatRamps',
      title: 'boatRamps',
      type: 'array',
      of: [{type: 'reference', to: [{type: 'spot'}]}],
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
      name: 'structure',
      title: 'Structure',
      type: 'array',
      of: [{type: 'reference', to: [{type: 'structure'}]}],
    }),
   defineField({
      name: 'relatedVideos',
      title: 'Related Videos',
      type: 'array',
      of: [{type: 'reference', to: [{type: 'video'}]}],
    }),
    defineField({
      name: 'depthRange',
      title: 'Depth Range (deprecated)',
      type: 'string',
    }),
    defineField({
      name: 'targetSpecies',
      title: 'Target Species',
      type: 'array',
      of: [{type: 'reference', to: [{type: 'targetSpecies'}]}],
    }),
    defineField({
      name: 'seasons',
      title: 'Seasons',
      type: 'array',
      of: [{type: 'reference', to: [{type: 'season'}]}],
    }),
    defineField({
      name: 'hazards',
      title: 'Hazards (deprecated)',
      type: 'text',
    }),
    defineField({
      name: 'microSeasons',
      title: 'Micro Seasons (deprecated)',
      type: 'text',
    }),
    defineField({
      name: 'approaches',
      title: 'Approaches',
      type: 'array',
      of: [{type: 'reference', to: [{type: 'approach'}]}],
    }),
    defineField({
      name: 'techniqueRetrieve',
      title: 'Technique Retrieve',
      type: 'array',
      of: [{type: 'reference', to: [{type: 'techniqueRetrieve'}]}],
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
      name: 'lureCatalog',
      title: 'Lure Catalog Field',
      type: 'array',
      of: [{type: 'reference', to: [{type: 'lureCatalog'}]}],
    }),
    defineField({
      name: 'mode',
      title: 'Mode',
      type: 'array',
      of: [{type: 'reference', to: [{type: 'mode'}]}],
    }),
    defineField({
      name: 'approachCodePrefix',
      title: 'Approach Code Prefix (deprecated)',
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
      name: 'microSeason',
      title: 'Micro Season',
      type: 'array',
      of: [{type: 'reference', to: [{type: 'microSeason'}]}],
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
      name: 'currentStationId',
      title: 'Current Station ID',
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
      name: 'captMikeNotes',
      title: 'Capt Mikes Notes',
      type: 'array',
      of: [
        {type: 'block'},
        {type: 'image', options: {hotspot: true}},
        {type: 'richTableBlock'},
      ],
    }),

    defineField({
      name: 'historicalAnalysis',
      title: 'Step 1 - Historical Analysis',
      type: 'array',
      of: [
        {type: 'block'},
        {type: 'image', options: {hotspot: true}},
        {type: 'richTableBlock'},
      ],
    }),

          defineField({
      name: 'environmentalFactors',
      title: 'Step 2 - Environmental Factors',
      type: 'array',
      of: [
        {type: 'block'},
        {type: 'image', options: {hotspot: true}},
        {type: 'richTableBlock'},
      ],
    }),


      defineField({
      name: 'observationalFactors',
      title: 'Step 3 - Observational Factors',
      type: 'array',
      of: [
        {type: 'block'},
        {type: 'image', options: {hotspot: true}},
        {type: 'richTableBlock'},
      ],
    }),


      defineField({
      name: 'structureApproach',
      title: 'Step 4 - Structure & Approach',
      type: 'array',
      of: [
        {type: 'block'},
        {type: 'image', options: {hotspot: true}},
        {type: 'richTableBlock'},
      ],
    }),

          defineField({
      name: 'gearTechnique',
      title: 'Step 5 - Gear & Technique',
      type: 'array',
      of: [
        {type: 'block'},
        {type: 'image', options: {hotspot: true}},
        {type: 'richTableBlock'},
      ],
    }),

          defineField({
      name: 'QAcaptMike',
      title: 'Q&A with Capt Mike',
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
      subtitle: 'spotId',
      media: 'featuredImage',
    },
  },
})
