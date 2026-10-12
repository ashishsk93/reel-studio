import type { InfluencerFields } from '@reel/shared';

export const SEED_INFLUENCERS: Array<InfluencerFields & { slug: string }> = [
  {
    slug: 'aanya-kapoor',
    name: 'Aanya Kapoor',
    age: 22,
    city: 'South Delhi',
    identityBlock:
      "Aanya Kapoor, a 22-year-old Punjabi woman from South Delhi, clearly a young adult in her early twenties. Warm light-brown skin with a fresh, dewy natural glow and realistic texture. Soft youthful face with full cheeks, high cheekbones and a gently rounded jaw, big bright dark-brown eyes with a playful, confident look, full natural eyebrows, straight nose, full lips. Voluminous dark-brown curly hair with face-framing curtain bangs, usually worn open. Small gold hoops with a stacked ear piercing. Slim build, about 5'5\". Signature look: glossy cherry-red lip tint and a thin playful winged liner, otherwise light fresh makeup. Cheeky, confident grin. An original person, not a celebrity or real individual.",
    shortIdentity:
      '22-year-old Punjabi woman, warm light-brown dewy skin, soft youthful face with full cheeks, big bright dark-brown eyes, voluminous dark-brown curly hair with curtain bangs, small gold hoops with a stacked ear piercing, glossy cherry-red lip tint, thin winged liner, cheeky confident grin',
    voiceNotes: 'Bold, witty, confident Hinglish. Short punchy hooks.',
    exampleLines: ['Beige is not a festival colour. I said what I said.', 'Main character, sorted 💅'],
    personality: 'Cheeky, confident, playful; says what she thinks.',
    lane: 'Festive glam with an edge; North Indian festivals (Diwali, Karwa Chauth, Lohri, weddings).',
    hashtag: '#AanyaPicks',
    signatureDetails: [
      'glossy cherry-red lip tint',
      'thin playful winged liner',
      'voluminous curly hair with curtain bangs, worn open',
      'small gold hoops with a stacked ear piercing',
    ],
    forbiddenFeatures: ['no nose ring or nose piercing'],
    conditionalFeatures: [
      {
        feature: 'a small crescent-moon tattoo on the inside of her left wrist',
        rule: 'show it only if the inside of her left wrist is visible in the frame; never anywhere else',
      },
    ],
    defaultStyling: 'Festive glam with an edge: bold lip, open curly hair, statement earrings with festive outfits.',
    homeOutfit: 'an oversized white t-shirt and grey lounge shorts',
    homeSetting: 'a cosy Delhi bedroom with a cream curtain and warm fairy lights',
  },
  {
    slug: 'meera-nair',
    name: 'Meera Nair',
    age: 23,
    city: 'Kochi, Kerala',
    identityBlock:
      'Meera Nair, a 23-year-old Malayali woman from Kochi, Kerala. Warm medium-brown skin with natural texture, oval face with a soft rounded jaw, large dark-brown almond-shaped eyes, thick natural eyebrows, small straight nose, full lips, and a small beauty mark just above the left side of her upper lip. Long, thick, glossy black hair to mid-back, usually in a single loose braid. Small gold jhumka earrings and a thin gold chain. Slim build, about 5\'4". Minimal natural makeup with a thin kajal line. Calm, warm, slightly shy expression. An original person, not a celebrity or real individual.',
    shortIdentity:
      '23-year-old Malayali woman, warm medium-brown skin, oval face, large dark-brown almond eyes, thick natural brows, small beauty mark just above the left side of her upper lip, long glossy black hair in a single loose braid, small gold jhumkas, thin gold chain, thin kajal, calm warm expression',
    voiceNotes: 'Warm, observant, gentle. Notices small details and says them simply.',
    // Placeholder lines (not in the brief); edit in the UI.
    exampleLines: ['Monsoon-ready and still pretty 🌧️', 'Kasavu, but make it everyday'],
    personality: 'Calm, warm, slightly shy, observant.',
    lane: 'Kerala-modern: cotton, kasavu, monsoon-friendly; Onam and Vishu.',
    hashtag: '#MeeraWears',
    signatureDetails: [
      'small beauty mark just above the left side of her upper lip',
      'long hair in a single loose braid',
      'small gold jhumka earrings and a thin gold chain',
      'thin kajal line',
    ],
    forbiddenFeatures: [],
    conditionalFeatures: [],
    defaultStyling: 'Minimal and natural: gold jhumkas, thin chain, single loose braid.',
    // Placeholders (not in the brief); edit in the UI.
    homeOutfit: 'a soft cotton kurti in muted sage green with loose white palazzos',
    homeSetting: 'a bright Kochi bedroom with white walls, wooden window shutters, potted plants and soft daylight',
  },
];
