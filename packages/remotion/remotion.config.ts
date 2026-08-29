// Match the old satori → resvg → ffmpeg encode: PNG frames, H.264, yuv420p.
import { Config } from '@remotion/cli/config';

Config.setVideoImageFormat('png');
Config.setCodec('h264');
Config.setPixelFormat('yuv420p');
