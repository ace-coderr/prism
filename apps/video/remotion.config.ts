import { Config } from '@remotion/cli/config';

// WebGL (the voxel crystal) in headless Chrome
Config.setChromiumOpenGlRenderer('angle');
Config.setVideoImageFormat('jpeg');
