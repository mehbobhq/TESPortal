/**
 * Presentation constants for the applicant experience.
 *
 * HERO_PHOTO: the welcome screen is designed for ONE geographically neutral photograph (a commercial truck on an open highway, no landmarks, no regional
 * scenery). That photograph is a licensed brand asset that is not part of this repository. Until it is supplied, the welcome screen uses the vector road
 * fallback below. To enable the photograph: add it as public/branding/hero-highway.jpg and set HERO_PHOTO to "/branding/hero-highway.jpg".
 */
export const HERO_PHOTO: string | null = null
export const HERO_FALLBACK = "/branding/hero-road.svg"
export const heroBackground = () => [HERO_PHOTO, HERO_FALLBACK].filter(Boolean).map((u) => `url('${u}')`).join(", ")
