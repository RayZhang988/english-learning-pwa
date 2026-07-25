import type {
  AssessmentBank,
  ChoiceAssessmentItem,
  ChoiceOption,
  SpeechAssessmentItem,
} from '../../src/features/assessment/types.ts'

const optionIds = ['a', 'b', 'c', 'd'] as const

function options(values: readonly string[]): readonly ChoiceOption[] {
  return values.map((text, index) => ({
    id: optionIds[index] ?? String(index),
    text,
  }))
}

function vocabularyChoice(input: {
  readonly id: string
  readonly format: 'word-meaning' | 'sentence-understanding'
  readonly difficulty: number
  readonly prompt: string
  readonly text: string
  readonly choices: readonly string[]
  readonly answer: 0 | 1 | 2 | 3
}): ChoiceAssessmentItem {
  return {
    id: input.id,
    schemaVersion: 1,
    domain: 'vocabulary',
    format: input.format,
    difficulty: input.difficulty,
    discrimination: 1,
    expectedSeconds: input.format === 'word-meaning' ? 22 : 32,
    prompt: input.prompt,
    tags: [input.format, `level-${input.difficulty}`],
    kind: 'choice',
    stimulus: {
      text: input.text,
      audioText: null,
      maxPlays: 0,
    },
    options: options(input.choices),
    scoring: {
      correctOptionId: optionIds[input.answer],
    },
  }
}

function listeningChoice(input: {
  readonly id: string
  readonly format:
    | 'listening-gist'
    | 'listening-detail'
    | 'listening-inference'
  readonly difficulty: number
  readonly audioText: string
  readonly prompt: string
  readonly choices: readonly string[]
  readonly answer: 0 | 1 | 2 | 3
}): ChoiceAssessmentItem {
  return {
    id: input.id,
    schemaVersion: 1,
    domain: 'listening',
    format: input.format,
    difficulty: input.difficulty,
    discrimination: 1,
    expectedSeconds: input.difficulty < 5 ? 38 : 48,
    prompt: input.prompt,
    tags: [input.format, `level-${input.difficulty}`],
    kind: 'choice',
    stimulus: {
      text: null,
      audioText: input.audioText,
      maxPlays: 2,
    },
    options: options(input.choices),
    scoring: {
      correctOptionId: optionIds[input.answer],
    },
  }
}

function speechItem(input: {
  readonly id: string
  readonly format: 'read-aloud' | 'repeat' | 'spoken-response'
  readonly difficulty: number
  readonly prompt: string
  readonly text?: string
  readonly audioText?: string
  readonly referenceText?: string
  readonly keyConcepts?: readonly (readonly string[])[]
}): SpeechAssessmentItem {
  return {
    id: input.id,
    schemaVersion: 1,
    domain: 'speaking',
    format: input.format,
    difficulty: input.difficulty,
    discrimination: 1,
    expectedSeconds: input.format === 'spoken-response' ? 90 : 65,
    prompt: input.prompt,
    tags: [input.format, `level-${input.difficulty}`],
    kind: 'speech',
    stimulus: {
      text: input.text ?? null,
      audioText: input.audioText ?? null,
      maxPlays: input.format === 'repeat' ? 2 : 0,
    },
    scoring: {
      rubric: input.format,
      referenceText: input.referenceText ?? null,
      keyConcepts: input.keyConcepts ?? [],
    },
  }
}

const vocabularyItems = [
  vocabularyChoice({
    id: 'vocab-word-01',
    format: 'word-meaning',
    difficulty: 1,
    prompt: 'Choose the closest meaning.',
    text: 'hungry',
    choices: ['needing food', 'feeling cold', 'being late', 'wanting sleep'],
    answer: 0,
  }),
  vocabularyChoice({
    id: 'vocab-word-02',
    format: 'word-meaning',
    difficulty: 2,
    prompt: 'Choose the closest meaning.',
    text: 'borrow',
    choices: [
      'give something away',
      'use something and return it later',
      'pay for something',
      'break something by accident',
    ],
    answer: 1,
  }),
  vocabularyChoice({
    id: 'vocab-word-03',
    format: 'word-meaning',
    difficulty: 3,
    prompt: 'Choose the closest meaning.',
    text: 'crowded',
    choices: [
      'very expensive',
      'easy to reach',
      'closed for repairs',
      'full of people',
    ],
    answer: 3,
  }),
  vocabularyChoice({
    id: 'vocab-word-04',
    format: 'word-meaning',
    difficulty: 4,
    prompt: 'Choose the closest meaning.',
    text: 'available',
    choices: [
      'already damaged',
      'ready to be used',
      'difficult to understand',
      'likely to disappear',
    ],
    answer: 1,
  }),
  vocabularyChoice({
    id: 'vocab-word-05',
    format: 'word-meaning',
    difficulty: 5,
    prompt: 'Choose the closest meaning.',
    text: 'reliable',
    choices: [
      'able to be trusted',
      'unusually quiet',
      'cheap to replace',
      'hard to notice',
    ],
    answer: 0,
  }),
  vocabularyChoice({
    id: 'vocab-word-06',
    format: 'word-meaning',
    difficulty: 6,
    prompt: 'Choose the closest meaning.',
    text: 'postpone',
    choices: [
      'explain in detail',
      'refuse completely',
      'finish ahead of time',
      'move to a later time',
    ],
    answer: 3,
  }),
  vocabularyChoice({
    id: 'vocab-word-07',
    format: 'word-meaning',
    difficulty: 7,
    prompt: 'Choose the closest meaning.',
    text: 'subtle',
    choices: [
      'not immediately obvious',
      'extremely dangerous',
      'officially approved',
      'roughly measured',
    ],
    answer: 0,
  }),
  vocabularyChoice({
    id: 'vocab-word-08',
    format: 'word-meaning',
    difficulty: 8,
    prompt: 'Choose the closest meaning.',
    text: 'reluctant',
    choices: [
      'unable to remember',
      'unwilling or hesitant',
      'ready to compete',
      'eager to apologize',
    ],
    answer: 1,
  }),
  vocabularyChoice({
    id: 'vocab-word-09',
    format: 'word-meaning',
    difficulty: 9,
    prompt: 'Choose the closest meaning.',
    text: 'mitigate',
    choices: [
      'prove beyond doubt',
      'divide into parts',
      'predict accurately',
      'make less severe',
    ],
    answer: 3,
  }),
  vocabularyChoice({
    id: 'vocab-word-10',
    format: 'word-meaning',
    difficulty: 10,
    prompt: 'Choose the closest meaning.',
    text: 'tenuous',
    choices: [
      'widely accepted',
      'weak or uncertain',
      'carefully organized',
      'morally necessary',
    ],
    answer: 1,
  }),
  vocabularyChoice({
    id: 'vocab-word-11',
    format: 'word-meaning',
    difficulty: 11,
    prompt: 'Choose the closest meaning.',
    text: 'equivocal',
    choices: [
      'open to more than one interpretation',
      'supported by direct evidence',
      'deliberately humorous',
      'impossible to reverse',
    ],
    answer: 0,
  }),
  vocabularyChoice({
    id: 'vocab-word-12',
    format: 'word-meaning',
    difficulty: 12,
    prompt: 'Choose the closest meaning.',
    text: 'specious',
    choices: [
      'based on personal experience',
      'expressed with unnecessary anger',
      'too technical for ordinary use',
      'seemingly convincing but actually false',
    ],
    answer: 3,
  }),
  vocabularyChoice({
    id: 'vocab-sentence-01',
    format: 'sentence-understanding',
    difficulty: 1,
    prompt: 'What does the sentence ask you to do?',
    text: 'Please close the window.',
    choices: [
      'Open the window.',
      'Stand near the window.',
      'Shut the window.',
      'Clean the window.',
    ],
    answer: 2,
  }),
  vocabularyChoice({
    id: 'vocab-sentence-02',
    format: 'sentence-understanding',
    difficulty: 2,
    prompt: 'Choose the best completion.',
    text: 'It is raining, so take an ___.',
    choices: ['ticket', 'address', 'appointment', 'umbrella'],
    answer: 3,
  }),
  vocabularyChoice({
    id: 'vocab-sentence-03',
    format: 'sentence-understanding',
    difficulty: 3,
    prompt: 'What happened?',
    text: 'Maya missed the bus, but she arrived on time by taking a taxi.',
    choices: [
      'She walked to work.',
      'She was late.',
      'She used a taxi after missing the bus.',
      'She drove the bus.',
    ],
    answer: 2,
  }),
  vocabularyChoice({
    id: 'vocab-sentence-04',
    format: 'sentence-understanding',
    difficulty: 4,
    prompt: 'Choose the closest meaning.',
    text: 'The store is open until nine except on Sundays.',
    choices: [
      'It always closes at nine.',
      'It opens only on Sundays.',
      'It closes before nine every day.',
      'Its Sunday hours are different.',
    ],
    answer: 3,
  }),
  vocabularyChoice({
    id: 'vocab-sentence-05',
    format: 'sentence-understanding',
    difficulty: 5,
    prompt: 'What does “it” refer to?',
    text: 'The phone was beside the lamp, but I moved it to the desk.',
    choices: ['the phone', 'the lamp', 'the desk', 'the room'],
    answer: 0,
  }),
  vocabularyChoice({
    id: 'vocab-sentence-06',
    format: 'sentence-understanding',
    difficulty: 6,
    prompt: 'Choose the closest meaning.',
    text: 'Had I known about the delay, I would have left later.',
    choices: [
      'I knew about the delay and left late.',
      'The delay happened after I arrived.',
      'I decided not to leave.',
      'I did not know, so I left earlier than necessary.',
    ],
    answer: 3,
  }),
  vocabularyChoice({
    id: 'vocab-sentence-07',
    format: 'sentence-understanding',
    difficulty: 7,
    prompt: 'What is implied?',
    text: 'The proposal is practical, although its cost may be difficult to justify.',
    choices: [
      'The proposal cannot work.',
      'The cost is definitely acceptable.',
      'Its feasibility and affordability are separate issues.',
      'No one has calculated the cost.',
    ],
    answer: 2,
  }),
  vocabularyChoice({
    id: 'vocab-sentence-08',
    format: 'sentence-understanding',
    difficulty: 8,
    prompt: 'Choose the closest meaning.',
    text: 'No sooner had the meeting begun than the fire alarm sounded.',
    choices: [
      'The alarm sounded just after the meeting started.',
      'The meeting began after the alarm stopped.',
      'The alarm prevented anyone from arriving.',
      'The meeting continued without interruption.',
    ],
    answer: 0,
  }),
  vocabularyChoice({
    id: 'vocab-sentence-09',
    format: 'sentence-understanding',
    difficulty: 9,
    prompt: 'What is the writer’s position?',
    text: 'The data are incomplete; nevertheless, they point toward a pattern worth investigating.',
    choices: [
      'The pattern has been proven.',
      'The data should be discarded.',
      'The evidence is limited but still suggestive.',
      'Further research would be pointless.',
    ],
    answer: 2,
  }),
  vocabularyChoice({
    id: 'vocab-sentence-10',
    format: 'sentence-understanding',
    difficulty: 10,
    prompt: 'Choose the closest meaning.',
    text: 'Her concession was less an admission of error than an attempt to move the debate forward.',
    choices: [
      'She fully accepted that she was wrong.',
      'She wanted the debate to end permanently.',
      'She refused to change her position.',
      'She yielded mainly to make progress.',
    ],
    answer: 3,
  }),
  vocabularyChoice({
    id: 'vocab-sentence-11',
    format: 'sentence-understanding',
    difficulty: 11,
    prompt: 'What does the sentence imply?',
    text: 'For all its apparent precision, the forecast rests on assumptions that are anything but secure.',
    choices: [
      'The forecast is precise because its assumptions are strong.',
      'The assumptions are unnecessary.',
      'The forecast deliberately avoids precise numbers.',
      'The forecast looks exact, but its foundation is uncertain.',
    ],
    answer: 3,
  }),
  vocabularyChoice({
    id: 'vocab-sentence-12',
    format: 'sentence-understanding',
    difficulty: 12,
    prompt: 'Choose the closest interpretation.',
    text: 'What the policy gains in administrative neatness, it risks losing in responsiveness to exceptional cases.',
    choices: [
      'The policy handles unusual cases better than ordinary ones.',
      'Administrative simplicity may reduce flexibility.',
      'The policy is too complicated to administer.',
      'Exceptional cases make the policy more consistent.',
    ],
    answer: 1,
  }),
] as const

const listeningItems = [
  listeningChoice({
    id: 'listen-gist-01',
    format: 'listening-gist',
    difficulty: 1,
    audioText: 'Hi, this is Nina. I am at the coffee shop across from the station.',
    prompt: 'Where is Nina?',
    choices: ['At a coffee shop', 'On a train', 'At home', 'In a hotel'],
    answer: 0,
  }),
  listeningChoice({
    id: 'listen-detail-02',
    format: 'listening-detail',
    difficulty: 2,
    audioText: 'The museum opens at ten, but our tour begins at ten thirty.',
    prompt: 'When does the tour begin?',
    choices: ['At 9:30', 'At 10:00', 'At 10:30', 'At 11:00'],
    answer: 2,
  }),
  listeningChoice({
    id: 'listen-inference-03',
    format: 'listening-inference',
    difficulty: 3,
    audioText: 'I would walk to work today, but those clouds look pretty dark.',
    prompt: 'What will the speaker probably do?',
    choices: [
      'Take another form of transportation',
      'Go for a long walk',
      'Stay at work overnight',
      'Wait for the weather report tomorrow',
    ],
    answer: 0,
  }),
  listeningChoice({
    id: 'listen-gist-04',
    format: 'listening-gist',
    difficulty: 4,
    audioText: 'The kitchen will close in twenty minutes, so please place any final food orders now.',
    prompt: 'Why is this announcement being made?',
    choices: [
      'To advertise a new menu',
      'To warn that food service is ending soon',
      'To ask customers to leave immediately',
      'To explain a delayed delivery',
    ],
    answer: 1,
  }),
  listeningChoice({
    id: 'listen-detail-05',
    format: 'listening-detail',
    difficulty: 5,
    audioText: 'Your room is on the fourth floor. Breakfast is served downstairs from seven until nine thirty.',
    prompt: 'What ends at 9:30?',
    choices: ['Room service', 'Elevator access', 'Front desk service', 'Breakfast'],
    answer: 3,
  }),
  listeningChoice({
    id: 'listen-inference-06',
    format: 'listening-inference',
    difficulty: 6,
    audioText: 'I sent the report yesterday. If it is not in your inbox, I can forward the original message.',
    prompt: 'What does the speaker imply?',
    choices: [
      'The report has not been written.',
      'The recipient may not have received the email.',
      'The report was sent to the wrong company.',
      'The original report has been deleted.',
    ],
    answer: 1,
  }),
  listeningChoice({
    id: 'listen-gist-07',
    format: 'listening-gist',
    difficulty: 7,
    audioText: 'We expected demand to slow after the holiday, yet orders have remained steady. For now, we will keep the extra weekend shift.',
    prompt: 'What is the main point?',
    choices: [
      'Holiday orders were canceled.',
      'Demand stayed strong enough to maintain extra staffing.',
      'Weekend work will end immediately.',
      'The company underestimated labor costs.',
    ],
    answer: 1,
  }),
  listeningChoice({
    id: 'listen-detail-08',
    format: 'listening-detail',
    difficulty: 8,
    audioText: 'The north entrance is closed for repairs. Visitors with tickets should use the garden gate, while deliveries must go to the loading dock.',
    prompt: 'Where should ticket holders enter?',
    choices: [
      'The north entrance',
      'The loading dock',
      'The garden gate',
      'The parking garage',
    ],
    answer: 2,
  }),
  listeningChoice({
    id: 'listen-inference-09',
    format: 'listening-inference',
    difficulty: 9,
    audioText: 'The apartment is farther from downtown than I wanted, but the extra room would let me work from home without using the kitchen table.',
    prompt: 'Why is the speaker still considering the apartment?',
    choices: [
      'It is close to downtown.',
      'The kitchen is unusually large.',
      'The rent has already been reduced.',
      'It includes office space.',
    ],
    answer: 3,
  }),
  listeningChoice({
    id: 'listen-gist-10',
    format: 'listening-gist',
    difficulty: 10,
    audioText: 'The trial did not show a statistically significant improvement overall. However, one subgroup responded consistently, which gives us a narrower question for the next study.',
    prompt: 'How does the speaker view the trial?',
    choices: [
      'As a complete success',
      'As useless because the main result was negative',
      'As inconclusive but informative for future research',
      'As proof that the treatment harms most people',
    ],
    answer: 2,
  }),
  listeningChoice({
    id: 'listen-detail-11',
    format: 'listening-detail',
    difficulty: 11,
    audioText: 'The committee endorsed the revised timeline, conditional on monthly progress reviews and a separate audit before the final release.',
    prompt: 'What must happen before the final release?',
    choices: [
      'A separate audit',
      'A public vote',
      'A change of committee members',
      'A second revision of the timeline',
    ],
    answer: 0,
  }),
  listeningChoice({
    id: 'listen-inference-12',
    format: 'listening-inference',
    difficulty: 12,
    audioText: 'Calling the decline temporary may be comforting, but it assumes the very recovery that the current figures fail to demonstrate.',
    prompt: 'What is the speaker criticizing?',
    choices: [
      'The accuracy of the current figures',
      'An optimistic conclusion that lacks supporting evidence',
      'The decision to publish a temporary report',
      'A recovery that happened too quickly',
    ],
    answer: 1,
  }),
  listeningChoice({
    id: 'listen-gist-02b',
    format: 'listening-gist',
    difficulty: 2,
    audioText: 'Attention passengers: the number twelve bus will leave from stop B instead of stop A today.',
    prompt: 'What changed?',
    choices: ['The fare', 'The route number', 'The departure stop', 'The driver'],
    answer: 2,
  }),
  listeningChoice({
    id: 'listen-detail-04b',
    format: 'listening-detail',
    difficulty: 4,
    audioText: 'I ordered the blue jacket in a medium, but the store sent me a black one in a large.',
    prompt: 'What size did the store send?',
    choices: ['Small', 'Medium', 'Large', 'Extra large'],
    answer: 2,
  }),
  listeningChoice({
    id: 'listen-gist-06b',
    format: 'listening-gist',
    difficulty: 6,
    audioText: 'Before we choose a vendor, let us compare not just the prices but also the support each company provides after purchase.',
    prompt: 'What does the speaker propose?',
    choices: [
      'Choosing the cheapest vendor immediately',
      'Considering service as well as price',
      'Delaying every purchase indefinitely',
      'Providing support to the vendors',
    ],
    answer: 1,
  }),
  listeningChoice({
    id: 'listen-detail-08b',
    format: 'listening-detail',
    difficulty: 8,
    audioText: 'Although the workshop begins on Thursday, the optional software setup session will be held online Wednesday evening.',
    prompt: 'When is the software setup session?',
    choices: [
      'Wednesday evening',
      'Thursday morning',
      'Thursday evening',
      'Friday afternoon',
    ],
    answer: 0,
  }),
  listeningChoice({
    id: 'listen-gist-10b',
    format: 'listening-gist',
    difficulty: 10,
    audioText: 'Automation removed several repetitive steps, but the time saved was absorbed by new review requirements. Output improved in consistency, not in speed.',
    prompt: 'What is the main conclusion?',
    choices: [
      'Automation made the process faster and less consistent.',
      'Review requirements were eliminated.',
      'Automation improved consistency without increasing speed.',
      'The repetitive steps were restored.',
    ],
    answer: 2,
  }),
  listeningChoice({
    id: 'listen-inference-12b',
    format: 'listening-inference',
    difficulty: 12,
    audioText: 'His apology addressed the disruption in exhaustive detail while remaining curiously silent about the decision that caused it.',
    prompt: 'What does the speaker imply about the apology?',
    choices: [
      'It fully accepted responsibility.',
      'It focused on consequences while avoiding the central cause.',
      'It was too brief to be useful.',
      'It explained why the decision was necessary.',
    ],
    answer: 1,
  }),
] as const

const speakingItems = [
  speechItem({
    id: 'speak-read-01',
    format: 'read-aloud',
    difficulty: 1,
    prompt: 'Read the sentence aloud.',
    text: 'I would like a glass of water, please.',
    referenceText: 'I would like a glass of water, please.',
  }),
  speechItem({
    id: 'speak-read-03',
    format: 'read-aloud',
    difficulty: 3,
    prompt: 'Read the sentence aloud.',
    text: 'The next train leaves from platform six at nine fifteen.',
    referenceText: 'The next train leaves from platform six at nine fifteen.',
  }),
  speechItem({
    id: 'speak-read-05',
    format: 'read-aloud',
    difficulty: 5,
    prompt: 'Read the sentence aloud.',
    text: 'Please let me know whether the new time works for everyone.',
    referenceText: 'Please let me know whether the new time works for everyone.',
  }),
  speechItem({
    id: 'speak-read-07',
    format: 'read-aloud',
    difficulty: 7,
    prompt: 'Read the sentence aloud.',
    text: 'Although the route is longer, it is usually more reliable during rush hour.',
    referenceText: 'Although the route is longer, it is usually more reliable during rush hour.',
  }),
  speechItem({
    id: 'speak-read-09',
    format: 'read-aloud',
    difficulty: 9,
    prompt: 'Read the sentence aloud.',
    text: 'The revised policy aims to reduce delays without placing an unreasonable burden on smaller teams.',
    referenceText: 'The revised policy aims to reduce delays without placing an unreasonable burden on smaller teams.',
  }),
  speechItem({
    id: 'speak-read-11',
    format: 'read-aloud',
    difficulty: 11,
    prompt: 'Read the sentence aloud.',
    text: 'What appears to be a minor procedural change may have far-reaching consequences for how evidence is evaluated.',
    referenceText: 'What appears to be a minor procedural change may have far-reaching consequences for how evidence is evaluated.',
  }),
  speechItem({
    id: 'speak-repeat-02',
    format: 'repeat',
    difficulty: 2,
    prompt: 'Listen, then repeat the sentence.',
    audioText: 'Could you show me where the restroom is?',
    referenceText: 'Could you show me where the restroom is?',
  }),
  speechItem({
    id: 'speak-repeat-04',
    format: 'repeat',
    difficulty: 4,
    prompt: 'Listen, then repeat the sentence.',
    audioText: 'We changed our reservation because the earlier flight was canceled.',
    referenceText: 'We changed our reservation because the earlier flight was canceled.',
  }),
  speechItem({
    id: 'speak-repeat-06',
    format: 'repeat',
    difficulty: 6,
    prompt: 'Listen, then repeat the sentence.',
    audioText: 'If the package arrives before noon, leave it with the front desk.',
    referenceText: 'If the package arrives before noon, leave it with the front desk.',
  }),
  speechItem({
    id: 'speak-repeat-08',
    format: 'repeat',
    difficulty: 8,
    prompt: 'Listen, then repeat the sentence.',
    audioText: 'The manager acknowledged the complaint but asked for more evidence before changing the policy.',
    referenceText: 'The manager acknowledged the complaint but asked for more evidence before changing the policy.',
  }),
  speechItem({
    id: 'speak-repeat-10',
    format: 'repeat',
    difficulty: 10,
    prompt: 'Listen, then repeat the sentence.',
    audioText: 'Despite initial skepticism, the proposal gained support once its long-term savings became clear.',
    referenceText: 'Despite initial skepticism, the proposal gained support once its long-term savings became clear.',
  }),
  speechItem({
    id: 'speak-repeat-12',
    format: 'repeat',
    difficulty: 12,
    prompt: 'Listen, then repeat the sentence.',
    audioText: 'The apparent consensus conceals substantial disagreement about which assumptions should guide the final decision.',
    referenceText: 'The apparent consensus conceals substantial disagreement about which assumptions should guide the final decision.',
  }),
  speechItem({
    id: 'speak-response-02',
    format: 'spoken-response',
    difficulty: 2,
    prompt: 'Say your name and one thing you like to do.',
    keyConcepts: [
      ['my name is', 'i am', "i'm"],
      ['i like', 'i enjoy', 'my favorite'],
    ],
  }),
  speechItem({
    id: 'speak-response-04',
    format: 'spoken-response',
    difficulty: 4,
    prompt: 'Ask a hotel employee for a quiet room for two nights.',
    keyConcepts: [
      ['room'],
      ['quiet', 'not noisy'],
      ['two nights', '2 nights'],
    ],
  }),
  speechItem({
    id: 'speak-response-06',
    format: 'spoken-response',
    difficulty: 6,
    prompt: 'Explain that you will be late and give a reason.',
    keyConcepts: [
      ['late', 'delay', 'behind schedule'],
      ['because', 'due to', 'the reason'],
    ],
  }),
  speechItem({
    id: 'speak-response-08',
    format: 'spoken-response',
    difficulty: 8,
    prompt: 'Describe one advantage and one disadvantage of working from home.',
    keyConcepts: [
      ['advantage', 'benefit', 'good thing', 'helps'],
      ['disadvantage', 'drawback', 'bad thing', 'problem'],
      ['work from home', 'working from home', 'remote work'],
    ],
  }),
  speechItem({
    id: 'speak-response-10',
    format: 'spoken-response',
    difficulty: 10,
    prompt: 'A city wants to reduce car traffic downtown. Give a recommendation and justify it.',
    keyConcepts: [
      ['should', 'recommend', 'could', 'need to'],
      ['because', 'so that', 'would reduce', 'would help'],
      ['traffic', 'cars', 'driving'],
    ],
  }),
  speechItem({
    id: 'speak-response-12',
    format: 'spoken-response',
    difficulty: 12,
    prompt: 'Explain why a policy can be efficient overall yet unfair in individual cases.',
    keyConcepts: [
      ['efficient', 'efficiency', 'works overall'],
      ['unfair', 'inequitable', 'individual cases', 'exceptions'],
      ['because', 'however', 'but', 'while'],
    ],
  }),
] as const

export const placementBankV1 = {
  id: 'placement-en-us-v1',
  schemaVersion: 1,
  locale: 'en-US',
  items: [
    ...vocabularyItems,
    ...listeningItems,
    ...speakingItems,
  ],
} as const satisfies AssessmentBank
