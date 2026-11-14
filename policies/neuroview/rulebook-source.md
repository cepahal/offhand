# NeuroView measurement rules (policy neuroview-v1)

Source document for the Amazon Bedrock Automated Reasoning policy attached to the guardrail in
`AI_GUARDRAIL_ID`. It is generated from `rulebook.json` and states only how the HoverScan
pipeline measures lesion masks from the ISBI 2015 Longitudinal MS Lesion Segmentation Challenge
dataset. It contains no clinical definitions and no medical advice.

## Rules

1. A lesion is a connected group of voxels, using 26-connectivity, marked in a lesion mask at one visit.
2. The consensus of both rater masks is the set of voxels that both rater 1 and rater 2 marked as lesion at that visit.
3. Visits are the subject's scan time points, numbered in order starting at 1. Visit t-1 is the visit before visit t.
4. A lesion volume in mm³ equals the number of its voxels times the volume of one voxel.
5. A lesion at visit t is reported only if it has at least 10 voxels.
6. A reported lesion at visit t is a new lesion if none of its voxels was marked as lesion at visit t-1.
7. A new lesion was not present at visit t-1.
8. Let P be the total volume of the lesions at visit t-1 that overlap a reported lesion of volume V at visit t, with P greater than 0. The lesion is an enlarged lesion if and only if V is at least 1.5 times P and V minus P is at least 20 mm³.
9. If V is greater than P, the lesion is up from P at visit t-1. If V is less than P, it is down from P.

## Measured facts for case isbi2015-training01

- The consensus of both rater masks shows a lesion of 45 mm³ at visit 2, not present at visit 1.
- The consensus of both rater masks shows a lesion of 269 mm³ at visit 3, up from 156 mm³ at visit 2.
- The consensus of both rater masks shows a lesion of 73 mm³ at visit 3, up from 32 mm³ at visit 2.
- The consensus of both rater masks shows a lesion of 18 mm³ at visit 4, not present at visit 3.
