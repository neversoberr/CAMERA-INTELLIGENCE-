# On-device person detector

`efficientdet-lite0.tflite` is Google's COCO EfficientDet-Lite0 v1 quantized object detector, including its label map. It is distributed unchanged from the [TensorFlow Lite Support repository](https://github.com/tensorflow/tflite-support/blob/5b56ec4d1479d3330d4f18f9a647d4c21d375d00/tensorflow_lite_support/cc/test/testdata/task/vision/coco_efficientdet_lite0_v1_1.0_quant_2021_09_06.tflite) under the Apache License 2.0 (see LICENSE.txt).

SHA-256: `dee1b4af055a644804d5594442300ecc9e4f7080c25b7c044c98f527eeabb6cf`.

The local MediaPipe Tasks Vision runtime is distributed under Apache-2.0 by Google. The app filters the model output to the `person` category. No identity or face matching is performed.

## Heavy sweep: EfficientDet-Lite2

`efficientdet-lite2-int8.tflite` is Google's quantized COCO EfficientDet-Lite2 object detector (448 × 448 input with embedded `person` label), used unmodified alongside Lite0. Upstream [MediaPipe int8 release 1](https://storage.googleapis.com/mediapipe-models/object_detector/efficientdet_lite2/int8/1/efficientdet_lite2.tflite), Apache-2.0 (see LICENSE.txt). The distributed bytes match the [pinned copy](https://github.com/dusy4/twitch-hackathon-codex/blob/b78d9592a77ff58489ac06dc15d92a85aa4d1cba/apps/android/app/src/main/assets/models/efficientdet_lite2_int8.tflite) and its published provenance. Size: 7,515,971 bytes; SHA-256: `b3f50554cb0ea559e90328845f7d9ba4d13c8bff372914d24e06bc8bb72fa896`.
