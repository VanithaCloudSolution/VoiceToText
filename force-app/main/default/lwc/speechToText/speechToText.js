import { LightningElement, api, wire, track } from 'lwc';
import { getObjectInfo } from 'lightning/uiObjectInfoApi';
import { updateRecord } from 'lightning/uiRecordApi';
import { ShowToastEvent } from 'lightning/platformShowToastEvent';
import saveAudioFile from '@salesforce/apex/AudioFileUploader.saveAudioFile';

export default class SpeechToText extends LightningElement {
    @api recordId;
    @api objectApiName;

    speechRecognition;
    isRecording = false;
    recognizedText = '';
    errorMessage = '';
    audioBase64 = ''; // Store audio data temporarily
    mediaRecorder;
    audioChunks = [];

    @track fields = [];
    selectedField = '';
    selectedLanguage = 'en-US'; // Default language

    languageOptions = [
        { label: 'English (US)', value: 'en-US' },
        { label: 'Spanish (Spain)', value: 'es-ES' },
        { label: 'French (France)', value: 'fr-FR' },
        { label: 'German (Germany)', value: 'de-DE' },
        { label: 'Hindi (India)', value: 'hi-IN' }
    ];

    @wire(getObjectInfo, { objectApiName: '$objectApiName' })
    wiredObjectInfo({ data, error }) {
        if (data) {
            this.fields = Object.keys(data.fields)
                .filter(fieldName => {
                    const field = data.fields[fieldName];
                    return field.updateable && 
                        ['String', 'TextArea', 'LongTextArea', 'RichText'].includes(field.dataType) &&
                        !field.compound; // Exclude Address fields
                })
                .map(fieldName => ({
                    label: data.fields[fieldName].label,
                    value: fieldName
                }));
        } else if (error) {
            this.fields = [];
            this.showToast('Error', 'Failed to fetch fields.', 'error');
        }
    }

    connectedCallback() {
        const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
        if (SpeechRecognition) {
            this.speechRecognition = new SpeechRecognition();
            this.speechRecognition.continuous = false;
            this.speechRecognition.lang = this.selectedLanguage;
            this.speechRecognition.interimResults = false;

            this.speechRecognition.onresult = (event) => {
                this.recognizedText = Array.from(event.results)
                    .map(result => result[0].transcript)
                    .join('');
            };

            this.speechRecognition.onerror = (event) => {
                this.errorMessage = `Error: ${event.error}`;
                this.showToast('Error', `Speech Recognition Error: ${event.error}`, 'error');
            };
        } else {
            this.errorMessage = 'Speech recognition is not supported in this browser.';
            this.showToast('Error', this.errorMessage, 'error');
        }
    }

    get isNotRecording() {
        return !this.isRecording;
    }

    get isSaveDisabled() {
        return !this.recognizedText || !this.selectedField || !this.recordId;
    }

    handleStart() {
        if (this.speechRecognition) {
            this.isRecording = true;
            this.speechRecognition.lang = this.selectedLanguage;
            this.speechRecognition.start();
        }

        // Start audio recording
        navigator.mediaDevices.getUserMedia({ audio: true })
            .then(stream => {
                this.mediaRecorder = new MediaRecorder(stream);
                this.audioChunks = [];
                this.mediaRecorder.start();

                this.mediaRecorder.ondataavailable = (event) => {
                    if (event.data.size > 0) {
                        this.audioChunks.push(event.data);
                    }
                };
            })
            .catch(error => {
                this.showToast('Error', 'Microphone access denied.', 'error');
            });
    }

    handleStop() {
        if (this.speechRecognition) {
            this.isRecording = false;
            this.speechRecognition.stop();
        }

        if (this.mediaRecorder) {
            this.mediaRecorder.stop();

            this.mediaRecorder.onstop = () => {
                const audioBlob = new Blob(this.audioChunks, { type: 'audio/wav' });
                this.convertToBase64(audioBlob);
            };

            // Stop microphone access
            if (this.mediaRecorder.stream) {
                this.mediaRecorder.stream.getTracks().forEach(track => track.stop());
            }
        }
    }

    convertToBase64(audioBlob) {
        const reader = new FileReader();
        reader.readAsDataURL(audioBlob);
        reader.onloadend = () => {
            this.audioBase64 = reader.result.split(',')[1]; // Store Base64 data for later
        };
    }

    handleClear() {
        this.recognizedText = '';
        this.errorMessage = '';
    }

    handleFieldChange(event) {
        this.selectedField = event.target.value;
    }

    handleLanguageChange(event) {
        this.selectedLanguage = event.target.value;
    }

    async handleSave() {
        if (!this.recordId || !this.selectedField || !this.recognizedText) {
            this.showToast('Warning', 'Please select a field and ensure there is text to save.', 'warning');
            return;
        }

        const fields = {
            Id: this.recordId,
            [this.selectedField]: this.recognizedText
        };

        try {
            await updateRecord({ fields });

            if (this.audioBase64) {
                this.uploadAudio(this.audioBase64, true); // Combine success toast
            } else {
                this.showToast('Success', 'Speech text saved successfully!', 'success');
            }
        } catch (error) {
            this.showToast('Error', 'Failed to save speech text.', 'error');
        }
    }

    uploadAudio(base64Data, isPartOfCombinedToast = false) {
        if (!this.recordId || !base64Data) {
            this.showToast('Error', 'Audio file is missing.', 'error');
            return;
        }

        const now = new Date();
        const timestamp = `${now.getFullYear()}-${(now.getMonth() + 1)
            .toString().padStart(2, '0')}-${now.getDate()
            .toString().padStart(2, '0')}_${now.getHours()
            .toString().padStart(2, '0')}-${now.getMinutes()
            .toString().padStart(2, '0')}-${now.getSeconds()
            .toString().padStart(2, '0')}`;

        const fileName = `${this.selectedField}_${timestamp}.wav`;

        saveAudioFile({ recordId: this.recordId, fileName, base64Data })
            .then(result => {
                if (result === 'Success') {
                    if (isPartOfCombinedToast) {
                        this.showToast('Success', 'Speech text and audio file saved successfully!', 'success');
                    } else {
                        this.showToast('Success', 'Audio file saved successfully!', 'success');
                    }
                } else {
                    console.error('Error Saving Audio:', result);
                    this.showToast('Error', 'Failed to save audio file.', 'error');
                }
            })
            .catch(error => {
                console.error('Upload Error:', error);
                this.showToast('Error', 'Failed to save audio file.', 'error');
            });
    }

    showToast(title, message, variant) {
        this.dispatchEvent(
            new ShowToastEvent({
                title,
                message,
                variant
            })
        );
    }
}