export type DesignViewportName = "desktop" | "tablet" | "mobile";

export type DesignViewportProfile = Readonly<{
  width: number;
  height: number;
  deviceScaleFactor: number;
  mobile: boolean;
}>;

export const DESIGN_VIEWPORT_PROFILES: Readonly<Record<DesignViewportName, DesignViewportProfile>> = {
  desktop: { width: 1_440, height: 900, deviceScaleFactor: 2, mobile: false },
  tablet: { width: 768, height: 900, deviceScaleFactor: 2, mobile: false },
  // Capture responsive CSS at a 390px layout viewport without enabling CDP's
  // mobile-device page-scale semantics. The latter can make the scroll range
  // use a taller layout viewport than window.innerHeight, leaving an
  // unobservable bottom gap even though screenshot pixels are 390x844 @2.
  mobile: { width: 390, height: 844, deviceScaleFactor: 2, mobile: false },
};
